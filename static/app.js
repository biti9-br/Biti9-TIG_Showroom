import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, OAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Config específica do cliente/ambiente vem de config.js (ver config.example.js
// para o template) - é o único arquivo que precisa mudar para trocar o banco
// de dados/tenant ao clonar este showroom para outro cliente.
const firebaseConfig = window.APP_CONFIG.firebase;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

const API_URL = '/api';

// Elementos
const automationIdInput = document.getElementById('automationId');
const automationNameInput = document.getElementById('automationName');
const automationProjectSelect = document.getElementById('automationProject');
const newProjectNameInput = document.getElementById('newProjectName');
const addProjectBtn = document.getElementById('addProjectBtn');
const automationUrlInput = document.getElementById('automationUrl');
const addBtn = document.getElementById('addBtn');
const automationsGrid = document.getElementById('automationsGrid');
const logsContainer = document.getElementById('logsContainer');
const countBadge = document.getElementById('countBadge');


let automationsData = [];
let projectsData = [];
let activeProject = 'Todos';
let currentUser = null;
let isAdmin = false; // Vem do claim "role" do token; define quem vê os controles de admin
let automationsFetchSeq = 0; // Evita que uma resposta antiga sobrescreva uma mais nova
let logsInterval = null;

// --- Auth Logic ---
// Tenant Azure AD do cliente (ver config.js) - null = sem restrição de tenant.
const MS_TENANT_ID = window.APP_CONFIG.msTenantId;

async function getAuthHeaders() {
    if (!auth.currentUser) return {};
    const token = await auth.currentUser.getIdToken();
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

async function loginWithMicrosoft() {
    const provider = new OAuthProvider("microsoft.com");
    if (MS_TENANT_ID) {
        provider.setCustomParameters({
            tenant: MS_TENANT_ID
        });
    }

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login Error:", error);
        alert("Erro no login: " + error.message);
    }
}

async function logout() {
    try {
        await firebaseSignOut(auth);
        location.reload(); // Recarrega a página ao sair
    } catch (error) {
        console.error("Logout Error:", error);
    }
}

function updateAuthUI(user) {
    currentUser = user; // Store globally
    isAdmin = false; // Só vira true depois de ler o claim do token (abaixo)
    const authContainer = document.getElementById('authContainer');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    // Elementos administrativos para controlar visibilidade
    const adminElements = {
        openModalBtn: document.getElementById('openModalBtn'),
        newProjectGroup: document.querySelector('.new-project-group'),
        openLogsModalBtn: document.getElementById('openLogsModalBtn'),
        openUserManagementBtn: document.getElementById('openUserManagementBtn'),
        openProjectManagementBtn: document.getElementById('openProjectManagementBtn')
    };

    if (user) {
        // Logged In
        const userInfo = document.createElement('div');
        userInfo.style.display = 'flex';
        userInfo.style.alignItems = 'center';
        userInfo.style.gap = '10px';

        const userName = document.createElement('span');
        userName.style.fontSize = '0.9rem';
        userName.style.color = 'var(--text-main)';
        const name = user.displayName || user.email;
        userName.innerText = `Olá, ${name}`;

        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'secondary-btn';
        logoutBtn.innerText = 'Sair';
        logoutBtn.style.padding = '4px 12px';
        logoutBtn.style.fontSize = '0.8rem';
        logoutBtn.addEventListener('click', logout);

        userInfo.appendChild(userName);
        userInfo.appendChild(logoutBtn);
        authContainer.appendChild(userInfo);

        // Logs ficam visíveis para todo usuário logado; os demais controles de admin
        // (cadastrar app/projeto, usuários) são liberados só pelo claim, mais abaixo.
        if (adminElements.openLogsModalBtn) adminElements.openLogsModalBtn.style.display = 'flex';
        if (adminElements.openModalBtn) adminElements.openModalBtn.style.display = 'none';
        if (adminElements.newProjectGroup) adminElements.newProjectGroup.style.display = 'none';

        // Inicia monitoramento de logs apenas se logado
        fetchLogs();
        if (!logsInterval) {
            logsInterval = setInterval(fetchLogs, 10000);
        }
    } else {
        // Logged Out
        const loginBtn = document.createElement('button');
        loginBtn.className = 'primary-btn';
        loginBtn.innerText = 'Entrar';
        loginBtn.style.padding = '6px 16px';
        loginBtn.style.fontSize = '0.8rem';
        loginBtn.id = 'loginBtn'; // Re-add ID for potential future use
        loginBtn.addEventListener('click', loginWithMicrosoft);

        authContainer.appendChild(loginBtn);

        // Quem não tem conta pede acesso por aqui (abre um chamado para o suporte)
        const requestAccessBtn = document.createElement('button');
        requestAccessBtn.className = 'secondary-btn';
        requestAccessBtn.innerText = 'Solicitar acesso';
        requestAccessBtn.style.padding = '6px 16px';
        requestAccessBtn.style.fontSize = '0.8rem';
        requestAccessBtn.addEventListener('click', openAccessRequestModal);

        authContainer.appendChild(requestAccessBtn);

        // Esconder elementos administrativos
        if (adminElements.openModalBtn) adminElements.openModalBtn.style.display = 'none';
        if (adminElements.newProjectGroup) adminElements.newProjectGroup.style.display = 'none';
        if (adminElements.openLogsModalBtn) adminElements.openLogsModalBtn.style.display = 'none';
        if (adminElements.openUserManagementBtn) adminElements.openUserManagementBtn.style.display = 'none';

        // Para monitoramento de logs se deslogado
        if (logsInterval) {
            clearInterval(logsInterval);
            logsInterval = null;
        }
    }

    // Controle fino de Admin via Token Claims
    if (user) {
        user.getIdTokenResult().then(idTokenResult => {
            const role = idTokenResult.claims.role;
            isAdmin = role === 'admin';
            if (isAdmin) {
                if (adminElements.openModalBtn) adminElements.openModalBtn.style.display = 'flex';
                if (adminElements.newProjectGroup) adminElements.newProjectGroup.style.display = 'flex';
                if (adminElements.openUserManagementBtn) adminElements.openUserManagementBtn.style.display = 'flex';
                if (adminElements.openProjectManagementBtn) adminElements.openProjectManagementBtn.style.display = 'flex';
                // Admin também recebe os apps inativos: rebusca já com o token
                fetchAutomations();
            } else {
                if (adminElements.openUserManagementBtn) adminElements.openUserManagementBtn.style.display = 'none';
                if (adminElements.openProjectManagementBtn) adminElements.openProjectManagementBtn.style.display = 'none';
                renderAutomations();
            }
        });
    }

    // Sempre re-renderiza automações para atualizar botões de editar/excluir nos cards
    renderAutomations();
}

// Monitor Auth State
onAuthStateChanged(auth, (user) => {
    updateAuthUI(user);

    if (user) {
        // Se acabou de logar e não tem timestamp, define agora
        if (!localStorage.getItem('loginTimestamp')) {
            localStorage.setItem('loginTimestamp', Date.now().toString());
        }
    } else {
        // Se deslogou, limpa o timestamp
        localStorage.removeItem('loginTimestamp');
    }
});

// --- Session Expiration Logic ---
const SESSION_DURATION = 60 * 60 * 1000; // 1 hora em ms
const sessionExpiredModal = document.getElementById('sessionExpiredModal');
const closeSessionExpiredBtn = document.getElementById('closeSessionExpiredBtn');

function checkSessionExpiration() {
    const loginTimestamp = localStorage.getItem('loginTimestamp');
    if (!loginTimestamp || !auth.currentUser) return;

    const now = Date.now();
    const elapsed = now - parseInt(loginTimestamp);

    if (elapsed >= SESSION_DURATION) {
        console.warn("Sessão expirada!");
        logout().then(() => {
            if (sessionExpiredModal) {
                sessionExpiredModal.showModal();
            }
        });
    }
}

if (closeSessionExpiredBtn) {
    closeSessionExpiredBtn.addEventListener('click', () => {
        sessionExpiredModal.close();
        loginWithMicrosoft();
    });
}

// Verifica a cada 30 segundos
setInterval(checkSessionExpiration, 30000);

// --- Access Request Logic ---
// Visitante sem conta informa o e-mail; o backend valida o domínio (@tigre) e abre o chamado por e-mail.
const accessRequestModal = document.getElementById('accessRequestModal');
const accessRequestForm = document.getElementById('accessRequestForm');
const accessRequestEmailInput = document.getElementById('accessRequestEmail');
const accessRequestFeedback = document.getElementById('accessRequestFeedback');
const accessRequestSubmitBtn = document.getElementById('accessRequestSubmitBtn');

function setAccessRequestFeedback(message, type) {
    // textContent (não innerHTML): a mensagem pode vir da resposta do servidor
    accessRequestFeedback.textContent = message;
    accessRequestFeedback.className = type ? `access-request-feedback ${type}` : 'access-request-feedback';
    accessRequestFeedback.style.display = message ? 'block' : 'none';
}

function openAccessRequestModal() {
    if (!accessRequestModal) return;
    accessRequestForm.reset();
    setAccessRequestFeedback('');
    accessRequestSubmitBtn.disabled = false;
    accessRequestModal.showModal();
    accessRequestEmailInput.focus();
}

async function submitAccessRequest(event) {
    event.preventDefault();
    const email = accessRequestEmailInput.value.trim();

    if (!email || !accessRequestEmailInput.checkValidity()) {
        setAccessRequestFeedback('Informe um e-mail válido.', 'error');
        return;
    }

    accessRequestSubmitBtn.disabled = true;
    setAccessRequestFeedback('Enviando solicitação...', 'info');

    try {
        const res = await fetch(`${API_URL}/access-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            // Mantém o botão desabilitado: evita reenviar o mesmo pedido sem querer
            setAccessRequestFeedback('Solicitação enviada! O suporte vai analisar o pedido e liberar o seu acesso.', 'success');
        } else {
            const message = typeof data.detail === 'string' ? data.detail : 'Não foi possível enviar a solicitação.';
            setAccessRequestFeedback(message, 'error');
            accessRequestSubmitBtn.disabled = false;
        }
    } catch (e) {
        console.error('Access Request Error:', e);
        setAccessRequestFeedback('Erro de conexão. Tente novamente.', 'error');
        accessRequestSubmitBtn.disabled = false;
    }
}

if (accessRequestForm) {
    accessRequestForm.addEventListener('submit', submitAccessRequest);
    document.getElementById('closeAccessRequestBtn').addEventListener('click', () => accessRequestModal.close());
    document.getElementById('cancelAccessRequestBtn').addEventListener('click', () => accessRequestModal.close());
}

// Funções
async function fetchData() {
    await fetchProjects();
    await fetchAutomations();
    fetchLogs();
    renderProjectTabs(); // Renderização inicial das abas
}

// Funções de requisição
async function fetchProjects() {
    try {
        const res = await fetch(`${API_URL}/projects`);
        if (res.ok) {
            projectsData = await res.json();
            renderProjectsSelect();
        }
    } catch (e) {
        console.error("Error fetching projects:", e);
    }
}

// Renderiza os projetos no select
function renderProjectsSelect() {
    const currentVal = automationProjectSelect.value;
    automationProjectSelect.innerHTML = '<option value="">Sem Projeto</option>';
    projectsData.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.innerText = p.name;
        if (p.id === currentVal) option.selected = true;
        automationProjectSelect.appendChild(option);
    });
    renderProjectTabs();
}

// Adiciona um novo projeto
async function addProject() {
    const name = newProjectNameInput.value.trim();
    if (!name) return;

    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/projects`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ name })
        });

        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' || data.status === 'exists') {
                newProjectNameInput.value = '';
                fetchProjects();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function fetchAutomations() {
    const seq = ++automationsFetchSeq;
    try {
        // Com token, o admin recebe também os apps inativos (o servidor filtra por papel)
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/automations`, { headers });
        if (res.ok && seq === automationsFetchSeq) {
            automationsData = await res.json();
            renderAutomations();
        }
    } catch (e) {
        console.error("Error fetching automations:", e);
    }
}

// Busca os logs
async function fetchLogs() {
    if (!currentUser) return; // Only fetch logs if logged in
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/logs`, {
            headers: headers
        });
        if (res.ok) {
            const logs = await res.json();
            renderLogs(logs);
        }
    } catch (e) {
        console.error("Error fetching logs:", e);
    }
}

// Busca usuários da administração
async function fetchAdminUsers() {
    const usersTableBody = document.getElementById('usersTableBody');
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Carregando usuários...</td></tr>';

    try {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${API_URL}/admin/users`, { headers });
        if (!resp.ok) throw new Error('Erro ao buscar usuários');
        const users = await resp.json();
        renderAdminUsers(users);
    } catch (error) {
        console.error('Erro:', error);
        usersTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--error);">Erro: ${error.message}</td></tr>`;
    }
}

function renderAdminUsers(users) {
    const usersTableBody = document.getElementById('usersTableBody');
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '';
    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--divider-soft)';

        tr.innerHTML = `
            <td>
                <div style="font-weight: 500; font-size: 0.85rem;">${u.displayName || 'Sem nome'}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${u.uid}</div>
            </td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">${u.email}</td>
            <td style="text-align: right;">
                <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-right: 8px; background: ${u.role === 'admin' ? 'rgba(255,107,107,0.1)' : 'rgba(107,255,184,0.1)'}; color: ${u.role === 'admin' ? '#ff6b6b' : '#6bffb8'};">
                    ${u.role.toUpperCase()}
                </span>
                <select onchange="updateUserRole('${u.uid}', this.value)">
                    <option value="colaborador" ${u.role === 'colaborador' ? 'selected' : ''}>Colaborador</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            </td>
        `;
        usersTableBody.appendChild(tr);
    });
}

async function updateUserRole(uid, newRole) {
    if (!confirm(`Deseja alterar a role para ${newRole}? O usuário precisará logar novamente.`)) {
        fetchAdminUsers(); // Reverte o select
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${API_URL}/admin/set-role`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ uid, role: newRole })
        });

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Erro ao atualizar role');
        }

        alert('Role atualizada com sucesso!');
        fetchAdminUsers();
    } catch (error) {
        alert('Erro: ' + error.message);
        fetchAdminUsers();
    }
}
window.updateUserRole = updateUserRole;

// Elementos do modal
const automationModal = document.getElementById('automationModal');
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');

// Abre o modal
if (openModalBtn && automationModal) {
    openModalBtn.addEventListener('click', () => {
        resetForm();
        document.querySelector('.modal-header h2').textContent = "Contribuir com agente";
        automationModal.showModal();
    });
}

// Fecha o modal
if (closeModalBtn && automationModal) {
    closeModalBtn.addEventListener('click', () => {
        automationModal.close();
    });
}

if (automationModal) {
    automationModal.addEventListener('click', (e) => {
        if (e.target === automationModal) {
            automationModal.close();
        }
    });
}

// Elementos do modal de logs
const logsModal = document.getElementById('logsModal');
const openLogsModalBtn = document.getElementById('openLogsModalBtn');
const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');

if (openLogsModalBtn && logsModal) {
    openLogsModalBtn.addEventListener('click', () => {
        logsModal.showModal();
        fetchLogs();
    });
}

// Fecha o modal de logs
if (closeLogsModalBtn && logsModal) {
    closeLogsModalBtn.addEventListener('click', () => {
        logsModal.close();
    });
}

// Elementos do modal de gerenciamento de usuários
const userManagementModal = document.getElementById('userManagementModal');
const openUserManagementBtn = document.getElementById('openUserManagementBtn');
const closeUserManagementBtn = document.getElementById('closeUserManagementBtn');

if (openUserManagementBtn && userManagementModal) {
    openUserManagementBtn.addEventListener('click', () => {
        userManagementModal.showModal();
        fetchAdminUsers();
    });
}

if (closeUserManagementBtn && userManagementModal) {
    closeUserManagementBtn.addEventListener('click', () => {
        userManagementModal.close();
    });
}

if (logsModal) {
    logsModal.addEventListener('click', (e) => {
        if (e.target === logsModal) {
            logsModal.close();
        }
    });
}

// =====================================================
// Project Management Modal
// =====================================================
const projectManagementModal = document.getElementById('projectManagementModal');
const openProjectManagementBtn = document.getElementById('openProjectManagementBtn');
const closeProjectManagementBtn = document.getElementById('closeProjectManagementBtn');
const saveProjectOrderBtn = document.getElementById('saveProjectOrderBtn');

if (openProjectManagementBtn && projectManagementModal) {
    openProjectManagementBtn.addEventListener('click', () => {
        renderProjectManagementList();
        projectManagementModal.showModal();
    });
}

if (closeProjectManagementBtn && projectManagementModal) {
    closeProjectManagementBtn.addEventListener('click', () => {
        projectManagementModal.close();
    });
}

if (projectManagementModal) {
    projectManagementModal.addEventListener('click', (e) => {
        if (e.target === projectManagementModal) projectManagementModal.close();
    });
}

// Renders the project list inside the management modal with DnD and delete
function renderProjectManagementList() {
    const list = document.getElementById('projectManagementList');
    if (!list) return;
    list.innerHTML = '';

    if (projectsData.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 1rem;">Nenhum projeto cadastrado.</p>';
        return;
    }

    let dragSrcIndex = null;

    projectsData.forEach((project, idx) => {
        const item = document.createElement('div');
        item.className = 'project-mgmt-item';
        item.dataset.id = project.id;
        item.dataset.idx = idx;
        item.draggable = true;
        item.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 14px;
            border-radius: 10px;
            background: var(--surface-faint);
            border: 1px solid var(--border-color);
            cursor: grab;
            transition: background 0.2s, border-color 0.2s, transform 0.15s;
        `;

        item.innerHTML = `
            <span style="color: var(--text-muted); cursor: grab; flex-shrink: 0;">
                <i data-lucide="grip-vertical" style="width:16px; height:16px; display:block;"></i>
            </span>
            <span class="pm-name" style="flex-grow:1; font-size:0.9rem; font-weight:500;">${project.name}</span>
            <input class="pm-input" type="text" value="${project.name}" style="flex-grow:1; display:none; background:var(--divider-strong); border:1px solid var(--border-color); border-radius:6px; padding:4px 8px; color:inherit; font-size:0.9rem;">
            <button class="pm-rename-btn secondary-btn" title="Renomear" style="padding:4px 10px; font-size:0.75rem;">
                <i data-lucide="pencil" style="width:13px;height:13px;"></i>
            </button>
            <button class="pm-delete-btn" title="Excluir" style="padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.12); color:#fca5a5; border:1px solid rgba(239,68,68,0.25); border-radius:6px; cursor:pointer;">
                <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
            </button>
        `;

        // --- Rename logic ---
        const nameSpan = item.querySelector('.pm-name');
        const nameInput = item.querySelector('.pm-input');
        const renameBtn = item.querySelector('.pm-rename-btn');

        renameBtn.addEventListener('click', () => {
            const isEditing = nameInput.style.display !== 'none';
            if (isEditing) {
                // Save rename
                const newName = nameInput.value.trim();
                if (newName && newName !== project.name) {
                    renameProject(project.id, newName, nameSpan, nameInput, renameBtn);
                } else {
                    nameSpan.style.display = '';
                    nameInput.style.display = 'none';
                    renameBtn.title = 'Renomear';
                    renameBtn.innerHTML = '<i data-lucide="pencil" style="width:13px;height:13px;"></i>';
                    if (window.lucide) window.lucide.createIcons();
                }
            } else {
                // Enter edit mode
                nameSpan.style.display = 'none';
                nameInput.style.display = '';
                nameInput.focus();
                renameBtn.title = 'Confirmar';
                renameBtn.innerHTML = '<i data-lucide="check" style="width:13px;height:13px;"></i>';
                if (window.lucide) window.lucide.createIcons();
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') renameBtn.click();
            if (e.key === 'Escape') {
                nameSpan.style.display = '';
                nameInput.style.display = 'none';
                nameInput.value = project.name;
                renameBtn.title = 'Renomear';
                renameBtn.innerHTML = '<i data-lucide="pencil" style="width:13px;height:13px;"></i>';
                if (window.lucide) window.lucide.createIcons();
            }
        });

        // --- Delete logic ---
        const deleteBtn = item.querySelector('.pm-delete-btn');
        deleteBtn.addEventListener('click', () => deleteProjectFromModal(project.id, project.name));

        // --- Drag and Drop ---
        item.addEventListener('dragstart', (e) => {
            dragSrcIndex = parseInt(item.dataset.idx);
            item.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            list.querySelectorAll('.project-mgmt-item').forEach(i => i.style.borderColor = '');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.style.borderColor = 'var(--primary)';
        });

        item.addEventListener('dragleave', () => {
            item.style.borderColor = '';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.style.borderColor = '';
            const targetIndex = parseInt(item.dataset.idx);
            if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

            // Re-order projectsData in memory
            const moved = projectsData.splice(dragSrcIndex, 1)[0];
            projectsData.splice(targetIndex, 0, moved);

            // Re-render list
            renderProjectManagementList();
        });

        list.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
}

async function renameProject(id, newName, nameSpan, nameInput, renameBtn) {
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/projects/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ name: newName })
        });
        if (res.ok) {
            // Update in memory
            const proj = projectsData.find(p => p.id === id);
            if (proj) proj.name = newName;
            nameSpan.textContent = newName;
            nameSpan.style.display = '';
            nameInput.style.display = 'none';
            nameInput.value = newName;
            renameBtn.title = 'Renomear';
            renameBtn.innerHTML = '<i data-lucide="pencil" style="width:13px;height:13px;"></i>';
            if (window.lucide) window.lucide.createIcons();
            renderProjectsSelect();
            renderProjectTabs();
        } else {
            alert('Erro ao renomear projeto.');
        }
    } catch (e) {
        console.error(e);
        alert('Erro de conexão.');
    }
}

async function deleteProjectFromModal(id, name) {
    if (!confirm(`Excluir o projeto "${name}"? Os apps vinculados ficam sem projeto.`)) return;
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/projects/${id}`, {
            method: 'DELETE',
            headers
        });
        if (res.ok) {
            // Remove from projectsData
            projectsData = projectsData.filter(p => p.id !== id);
            renderProjectsSelect();
            renderProjectTabs();
            renderProjectManagementList();
        } else {
            alert('Erro ao excluir projeto.');
        }
    } catch (e) {
        console.error(e);
        alert('Erro de conexão.');
    }
}

if (saveProjectOrderBtn) {
    saveProjectOrderBtn.addEventListener('click', async () => {
        const ids = projectsData.map(p => p.id);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_URL}/projects/reorder`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ order: ids })
            });
            if (res.ok) {
                renderProjectsSelect();
                renderProjectTabs();
                saveProjectOrderBtn.textContent = '\u2713 Salvo!';
                setTimeout(() => {
                    saveProjectOrderBtn.innerHTML = '<i data-lucide="save" style="width:15px;height:15px;"></i> Salvar Ordem';
                    if (window.lucide) window.lucide.createIcons();
                }, 2000);
                if (window.lucide) window.lucide.createIcons();
            } else {
                alert('Erro ao salvar ordem.');
            }
        } catch (e) {
            console.error(e);
            alert('Erro de conexão.');
        }
    });
}

// Lógica do menu colapsável
const gridMenuBtn = document.getElementById('gridMenuBtn');
const collapsibleMenu = document.getElementById('collapsibleMenu');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const sidebar = document.querySelector('.sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

// Helper para alternar o sidebar
function toggleSidebar() {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('active');
}

// Helper para fechar o sidebar
function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
}

if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
}

// --- Tema claro/escuro ---
// O atributo data-theme já é aplicado antes do primeiro paint por um script
// inline no <head> (evita flash do tema errado). O ícone sol/lua troca
// sozinho via CSS a partir desse atributo (ver style.css) - o JS aqui só
// precisa alternar o atributo e persistir a escolha.
const THEME_STORAGE_KEY = 'tigre-showroom-theme';
const themeToggleBtn = document.getElementById('themeToggleBtn');

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) {}
    document.documentElement.setAttribute('data-theme', next);
}

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
}

// Close sidebar when clicking a nav link on mobile
document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            closeSidebar();
        }
    });
});

if (gridMenuBtn && collapsibleMenu) {
    gridMenuBtn.addEventListener('click', () => {
        const isOpen = collapsibleMenu.classList.contains('open');
        if (isOpen) {
            collapsibleMenu.classList.remove('open');
            gridMenuBtn.classList.remove('active');
        } else {
            collapsibleMenu.classList.add('open');
            gridMenuBtn.classList.add('active');
        }
    });
}

// Garante que o picker de ícones seja inicializado dentro do modal se necessário, ou global
// Se os inputs estiverem agora no modal, Picmo pode precisar de re-attaching ou funciona se o ID corresponder.
// Nota: Picmo popups podem ser cobertos pelo modal se z-index não for tratado, mas o diálogo nativo está na camada superior.

async function saveAutomation() {
    const id = automationIdInput.value;
    const name = automationNameInput.value;
    const project = automationProjectSelect.value;
    const url = automationUrlInput.value;
    const icon = document.getElementById('automationIcon').value;
    const short_description = document.getElementById('automationShortDescription').value;
    const tool = document.getElementById('automationTool').value;
    const creation_date = document.getElementById('automationCreationDate').value;
    const is_featured = document.getElementById('automationFeatured').checked;
    const creator = document.getElementById('automationCreator').value;

    // AI APIs
    const aiApisStr = document.getElementById('automationAiApis').value;
    const ai_apis_used = aiApisStr ? aiApisStr.split(',').map(s => s.trim()) : [];

    if (!name || !url) {
        alert("Nome e URL são obrigatórios!");
        return;
    }

    const payload = {
        name,
        url,
        projectId: project,
        projectName: automationProjectSelect.options[automationProjectSelect.selectedIndex].text,
        icon,
        shortDescription: short_description,
        tool,
        creator,
        isFeatured: is_featured,
        aiApisUsed: ai_apis_used
    };

    try {
        const headers = await getAuthHeaders();
        let res;
        if (id) {
            // Edit
            res = await fetch(`${API_URL}/automations/${id}`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            res = await fetch(`${API_URL}/automations`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            automationModal.close();
            fetchAutomations();
        } else {
            alert("Erro ao salvar automação.");
        }
    } catch (e) {
        console.error(e);
        alert("Erro de conexão.");
    }
}

// Função para editar uma automação
function editAutomation(id) {
    const auto = automationsData.find(a => a.id === id);
    if (!auto) return;

    automationIdInput.value = auto.id;
    automationNameInput.value = auto.name;
    automationProjectSelect.value = auto.projectId || "";
    automationUrlInput.value = auto.url;
    document.getElementById('automationIcon').value = auto.icon || "";
    document.getElementById('automationShortDescription').value = auto.shortDescription || "";
    document.getElementById('automationTool').value = auto.tool || '';
    document.getElementById('automationCreator').value = auto.creator || '';
    document.getElementById('automationAiApis').value = (auto.aiApisUsed || []).join(', ');
    document.getElementById('automationFeatured').checked = !!auto.isFeatured;

    addBtn.innerText = "Salvar Alterações";
    document.querySelector('.modal-header h2').textContent = "Editar Automação";
    automationModal.showModal();
}

// Função para resetar o formulário
function resetForm() {
    automationIdInput.value = '';
    automationNameInput.value = '';
    automationProjectSelect.value = '';
    automationUrlInput.value = '';
    document.getElementById('automationIcon').value = '';
    document.getElementById('automationShortDescription').value = '';
    document.getElementById('automationTool').value = '';
    document.getElementById('automationCreationDate').value = '';
    document.getElementById('automationCreator').value = '';
    document.getElementById('automationAiApis').value = '';
    document.getElementById('automationFeatured').checked = false;

    addBtn.innerText = "Adicionar";
    const headerTitle = document.querySelector('.modal-header h2');
    if (headerTitle) headerTitle.textContent = "Nova Automação";
}

// Função para deletar uma automação
async function deleteAutomation(id) {
    if (!confirm("Tem certeza que deseja remover?")) return;
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/automations/${id}`, {
            method: 'DELETE',
            headers: headers
        });
        if (res.ok) {
            fetchAutomations();
        } else {
            alert("Erro ao remover.");
        }
    } catch (e) {
        console.error(e);
        alert("Erro de conexão.");
    }
}

// Função para ativar/inativar uma automação (somente admin; o servidor também valida)
async function toggleAutomationActive(id, active) {
    if (!active && !confirm("Inativar esta aplicação? Ela deixa de aparecer para os colaboradores.")) return;
    const action = active ? 'ativar' : 'inativar';
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/automations/${id}/active`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ active })
        });
        if (res.ok) {
            fetchAutomations();
        } else {
            alert(`Erro ao ${action}.`);
        }
    } catch (e) {
        console.error(e);
        alert("Erro de conexão.");
    }
}

// Função para renderizar as tabs de projetos
function renderProjectTabs() {
    const tabsContainer = document.getElementById('projectTabsContainer');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '';

    // "Todos" tab
    const allBtn = document.createElement('button');
    allBtn.className = `category-btn ${activeProject === 'Todos' ? 'active' : ''}`;
    allBtn.innerText = 'Todos';
    allBtn.onclick = () => setActiveProject('Todos');
    tabsContainer.appendChild(allBtn);

    // Dynamic tabs
    projectsData.forEach(p => {
        const btn = document.createElement('button');
        btn.className = `category-btn ${activeProject === p.id ? 'active' : ''}`;
        btn.innerText = p.name;
        btn.onclick = () => setActiveProject(p.id);
        tabsContainer.appendChild(btn);
    });

    // Atualiza visibilidade das setas após renderizar
    setTimeout(updateTabsArrows, 50);
}

// Atualiza a visibilidade das setas de navegação das tabs
function updateTabsArrows() {
    const container = document.getElementById('projectTabsContainer');
    const arrowLeft = document.getElementById('tabsArrowLeft');
    const arrowRight = document.getElementById('tabsArrowRight');
    if (!container || !arrowLeft || !arrowRight) return;

    const scrollLeft = container.scrollLeft;
    const maxScroll = container.scrollWidth - container.clientWidth;

    // Seta esquerda: visível apenas se há scroll para a esquerda
    arrowLeft.classList.toggle('visible', scrollLeft > 4);

    // Seta direita: visível apenas se há mais conteúdo à direita
    arrowRight.classList.toggle('visible', scrollLeft < maxScroll - 4);
}

// Inicializa os listeners das setas de tabs (executado uma vez)
(function initTabsArrows() {
    const container = document.getElementById('projectTabsContainer');
    const arrowLeft = document.getElementById('tabsArrowLeft');
    const arrowRight = document.getElementById('tabsArrowRight');
    if (!container || !arrowLeft || !arrowRight) return;

    const SCROLL_STEP = 300;

    arrowLeft.addEventListener('click', () => {
        container.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' });
    });

    arrowRight.addEventListener('click', () => {
        container.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' });
    });

    container.addEventListener('scroll', updateTabsArrows);
    window.addEventListener('resize', updateTabsArrows);
})();

// Função para definir o projeto ativo
function setActiveProject(project) {
    activeProject = project;
    renderProjectTabs(); // Re-render to update active state
    renderAutomations(); // Re-render grid filtered
}

// Função para renderizar as automações
function renderAutomations() {
    // Filtra com base no projeto ativo
    let filtered = automationsData;
    if (activeProject !== 'Todos') {
        filtered = automationsData.filter(a => {
            if (activeProject === 'Sem Projeto') return !a.projectId;
            return a.projectId === activeProject;
        });
    }

    // Apps inativos só chegam para admin: ficam numa seção própria, fora da contagem e do online/offline
    const inactiveApps = filtered.filter(a => a.active === false);
    filtered = filtered.filter(a => a.active !== false);

    // Update Header Title
    const projectTitle = document.getElementById('projectTitle');
    if (projectTitle) {
        if (activeProject === 'Todos') {
            projectTitle.innerText = 'Todos';
        } else if (activeProject === 'Sem Projeto') {
            projectTitle.innerText = 'Sem Projeto';
        } else {
            const proj = projectsData.find(p => p.id === activeProject);
            projectTitle.innerText = proj ? proj.name : activeProject;
        }
    }

    // Filter Logic... (already done above)

    // Count Logic: Show only ONLINE apps count
    const onlineCount = filtered.filter(a => {
        const code = a.statusCode;
        return code && ((code >= 200 && code < 300) || code === 403);
    }).length;

    countBadge.innerText = onlineCount;
    automationsGrid.innerHTML = '';

    if (filtered.length === 0 && inactiveApps.length === 0) {
        automationsGrid.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; grid-column: 1/-1; text-align:center; padding: 2rem;">Nenhuma aplicação neste projeto.</div>';
        return;
    }

    // Ordena/ Agrupa por Online vs Offline e prioriza Destaques
    const onlineApps = [];
    const offlineApps = [];

    // Primeiro, ordena por isFeatured (true primeiro)
    const sortedData = [...filtered].sort((a, b) => {
        if (a.isFeatured === b.isFeatured) return 0;
        return a.isFeatured ? -1 : 1;
    });

    sortedData.forEach(auto => {
        const code = auto.statusCode;
        const isOnline = code && ((code >= 200 && code < 300) || code === 403);
        if (isOnline) {
            onlineApps.push(auto);
        } else {
            offlineApps.push(auto);
        }
    });

    // Função para renderizar uma seção
    const renderSection = (title, apps, color, type) => {
        if (apps.length === 0) return;

        // Container da seção
        const container = document.createElement('div');
        container.style.gridColumn = "1 / -1";
        container.style.marginTop = "1.5rem";
        container.style.marginBottom = "0.5rem";
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.gap = "12px";

        // Badge + Divider
        container.innerHTML = `
            <div class="status-indicator-new" style="background: var(--divider-soft); border: 1px solid var(--divider-strong); padding: 6px 12px;">
                <div class="status-dot-indicator ${type}"></div>
                <span style="color: ${color}; letter-spacing: 1px; font-size: 0.8rem;">${title}</span>
            </div>
            <div style="flex-grow:1; height:1px; background: linear-gradient(90deg, ${color}33, transparent);"></div>
        `;

        automationsGrid.appendChild(container);

        // App Cards
        apps.forEach(auto => {
            automationsGrid.appendChild(createAutomationCard(auto));
        });
    };

    // Renderiza ONLINE primeiro
    if (onlineApps.length > 0) {
        renderSection('ONLINE', onlineApps, 'var(--online)', 'online');
    }

    // Renderiza OFFLINE segundo (Collapsible)
    if (offlineApps.length > 0) {
        // Toggle Button Container
        const toggleContainer = document.createElement('div');
        toggleContainer.style.gridColumn = "1 / -1";
        toggleContainer.style.marginTop = "2rem";
        toggleContainer.style.textAlign = "center";
        toggleContainer.style.cursor = "pointer";

        const toggleBtn = document.createElement('button');
        toggleBtn.innerText = "Ver apps offline";
        toggleBtn.className = "offline-toggle-btn";

        toggleContainer.appendChild(toggleBtn);
        automationsGrid.appendChild(toggleContainer);

        // Container de Apps Offline
        const offlineContainer = document.createElement('div');
        offlineContainer.className = "offline-apps-container";
        offlineContainer.style.display = "none";
        offlineContainer.style.gridColumn = "1 / -1";

        const innerGrid = document.createElement('div');
        innerGrid.className = "automations-grid";
        innerGrid.style.marginTop = "1rem";

        offlineContainer.appendChild(innerGrid);
        automationsGrid.appendChild(offlineContainer);

        // Toggle Logic
        toggleBtn.addEventListener('click', () => {
            const isHidden = offlineContainer.style.display === "none";
            if (isHidden) {
                offlineContainer.style.display = "block";
                toggleBtn.innerText = "Ocultar apps offline";
                toggleBtn.classList.add('active');
            } else {
                offlineContainer.style.display = "none";
                toggleBtn.innerText = "Ver apps offline";
                toggleBtn.classList.remove('active');
            }
        });

        // Renderiza apps into innerGrid
        offlineApps.forEach(auto => {
            innerGrid.appendChild(createAutomationCard(auto));
        });
    }

    // Renderiza INATIVOS por último (somente admin; recolhido)
    if (inactiveApps.length > 0) {
        const inactiveToggleContainer = document.createElement('div');
        inactiveToggleContainer.style.gridColumn = "1 / -1";
        inactiveToggleContainer.style.marginTop = "2rem";
        inactiveToggleContainer.style.textAlign = "center";

        const inactiveToggleBtn = document.createElement('button');
        inactiveToggleBtn.innerText = `Ver apps inativos (${inactiveApps.length})`;
        inactiveToggleBtn.className = "offline-toggle-btn";
        inactiveToggleContainer.appendChild(inactiveToggleBtn);
        automationsGrid.appendChild(inactiveToggleContainer);

        const inactiveContainer = document.createElement('div');
        inactiveContainer.style.display = "none";
        inactiveContainer.style.gridColumn = "1 / -1";

        const inactiveGrid = document.createElement('div');
        inactiveGrid.className = "automations-grid";
        inactiveGrid.style.marginTop = "1rem";
        inactiveApps.forEach(auto => {
            inactiveGrid.appendChild(createAutomationCard(auto));
        });
        inactiveContainer.appendChild(inactiveGrid);
        automationsGrid.appendChild(inactiveContainer);

        inactiveToggleBtn.addEventListener('click', () => {
            const isHidden = inactiveContainer.style.display === "none";
            inactiveContainer.style.display = isHidden ? "block" : "none";
            inactiveToggleBtn.innerText = isHidden ? "Ocultar apps inativos" : `Ver apps inativos (${inactiveApps.length})`;
            inactiveToggleBtn.classList.toggle('active', isHidden);
        });
    }

    // Re-initialize icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function createAutomationCard(auto) {
    // Determine status based on statusCode
    // Check if statusCode is defined and within 200-299 range (or 403) for online
    const code = auto.statusCode;
    const isOnline = code && ((code >= 200 && code < 300) || code === 403);
    const statusText = isOnline ? 'online' : (code ? 'offline' : 'pending');

    // Status text for display (capitalized or just 'online'/'offline')
    const displayStatus = statusText;

    const statusClass = isOnline ? 'online' : 'offline';

    // Badge Logic
    let badgeHtml = '';
    if (auto.isFeatured) {
        badgeHtml = `
        <div class="badge badge-featured">
            <i data-lucide="trending-up" style="width:12px;height:12px;"></i>
            Destaque!
        </div>`;
    }

    // App inativo (só admin recebe): selo à esquerda, para não colidir com o de destaque
    const isInactive = auto.active === false;
    if (isInactive) {
        badgeHtml += `
        <div class="badge badge-inactive">
            <i data-lucide="eye-off" style="width:12px;height:12px;"></i>
            Inativo
        </div>`;
    }

    const card = document.createElement('div');
    card.className = `app-card ${auto.isFeatured ? 'card-featured' : ''} ${isInactive ? 'card-inactive' : ''} ${!currentUser ? 'card-locked' : ''}`;

    if (currentUser) {
        card.onclick = () => window.open(auto.url, '_blank');
        card.style.cursor = 'pointer';
    } else {
        card.onclick = () => {
            const authAlertModal = document.getElementById('authAlertModal');
            if (authAlertModal) authAlertModal.showModal();
        };
        card.style.cursor = 'pointer';
        card.title = "Faça login para acessar esta automação";
    }

    // Image Logic
    const DEFAULT_IMAGE = 'https://i.ibb.co/Kpst2zBk/Captura-de-tela-2026-02-04-200727.png';
    const SPECIFIC_IMAGE = 'https://i.ibb.co/xSXXHpcN/analise-chamados.png';
    const SPECIFIC_NAME = 'analise de perfomance da operaçao'; // normalize check

    let imgSrc = DEFAULT_IMAGE;

    // Check specific name (normalization for safety)
    if (auto.name && auto.name.toLowerCase().includes('analise de perfomance da operaçao')) {
        imgSrc = SPECIFIC_IMAGE;
    }
    // If icon is a URL, use it
    else if (auto.icon && (auto.icon.startsWith('http') || auto.icon.startsWith('data:image'))) {
        imgSrc = auto.icon;
    }

    // AI APIs Tags
    let aiTags = '';
    if (auto.aiApisUsed && auto.aiApisUsed.length > 0) {
        aiTags = `<div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:8px;">`;
        auto.aiApisUsed.forEach(api => {
            aiTags += `<span style="font-size:0.7rem; background:var(--divider-strong); padding:2px 6px; border-radius:4px; color:var(--text-muted);">${api}</span>`;
        });
        aiTags += `</div>`;
    }

    // Creator Info
    let creatorInfo = '';
    if (auto.creator) {
        creatorInfo = `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Criado por: <span style="color:var(--text-muted);">${auto.creator}</span></div>`;
    }

    card.innerHTML = `
        <div class="holographic-flare"></div>
        ${badgeHtml}
        
        ${isAdmin ? `
        <div class="card-actions">
             <div class="action-btn" onclick="event.stopPropagation(); toggleAutomationActive('${auto.id}', ${isInactive})" title="${isInactive ? 'Ativar' : 'Inativar'}">
                <i data-lucide="${isInactive ? 'eye' : 'eye-off'}" style="width:14px;height:14px;"></i>
             </div>
             <div class="action-btn" onclick="event.stopPropagation(); editAutomation('${auto.id}')" title="Editar">
                <i data-lucide="pencil" style="width:14px;height:14px;"></i>
             </div>
             <div class="action-btn" onclick="event.stopPropagation(); deleteAutomation('${auto.id}')" title="Remover">
                <i data-lucide="trash" style="width:14px;height:14px;"></i>
             </div>
        </div>
        ` : ''}

        <div class="card-image-container">
            <img src="${imgSrc}" alt="${auto.name}" class="card-image">
        </div>

        <div class="card-header">
            <!-- Stats Column only, removed emoji container -->
            <div class="stats-column" style="margin-left: auto;">
                ${(!isOnline && code) ? `
                <div class="stat-box">
                    <i data-lucide="activity" style="width:12px;height:12px;color:#fbbf24;"></i>
                    <span class="stat-text">${code}</span>
                </div>` : ''}
            </div>
        </div>

        <div class="card-content">
            <h3 class="app-name">${auto.name}</h3>
            
            ${auto.shortDescription ? `<p class="app-description">${auto.shortDescription}</p>` : ''}
            
            ${auto.tool ? `<div style="font-size:0.8rem; color:var(--info-text); font-weight:600;">${auto.tool}</div>` : ''}
            
            ${creatorInfo}
            ${aiTags}
        </div>

        <div class="card-footer">
            <div class="app-category">
                <div class="status-dot-cat"></div>
                <span class="category-text">${auto.projectName || 'GERAL'}</span>
            </div>
            <div class="status-indicator-new">
                 <div class="status-dot-indicator ${statusClass}"></div>
                 <span style="color:${isOnline ? 'var(--online)' : 'var(--offline)'}">${displayStatus}</span>
            </div>
        </div>
    `;
    return card;
}

// Função para renderizar os logs
function renderLogs(logs) {
    logsContainer.innerHTML = '';
    logs.forEach(log => {
        // Formata para 'DD/MM/AAAA HH:MM:SS'
        const dateObj = new Date(log.timestamp);
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString();

        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
            <span class="log-time">[${dateStr} ${timeStr}]</span>
            <span class="log-message log-type-${log.type}">${log.message}</span>
        `;
        logsContainer.appendChild(div);
    });
}

// Project Emoji Mapping
const projectEmojis = {
    'Marketing': '📣',
    'Financeiro': '💰',
    'Finanças': '💰',
    'Vendas': '🛒',
    'Comercial': '🛒',
    'Pré Vendas': '🛒',
    'Performance': '🚀',
    'Operação': '🚀',
    'PDF': '📄',
    'Geral': '🌐',
    'Gente e Gestão': '👥',
    'Processos': '⚙️'
};

// Event Listeners
addBtn.addEventListener('click', saveAutomation);
addProjectBtn.addEventListener('click', addProject);


// Event Listeners
automationProjectSelect.addEventListener('change', (e) => {
    const project = e.target.value;
    const emojiInput = document.getElementById('automationIcon'); // Updated ID

    if (!emojiInput) return;

    const currentVal = emojiInput.value.trim();
    const isDefault = Object.values(projectEmojis).includes(currentVal) || currentVal === 'globe' || currentVal === '🌐' || currentVal === '';

    if (isDefault) {
        if (projectEmojis[project]) {
            emojiInput.value = projectEmojis[project];
        } else {

            if (project.includes('Financ')) emojiInput.value = '💰';
            else if (project.includes('Vend') || project.includes('Comercial')) emojiInput.value = '🛒';
            else if (project.includes('Perf') || project.includes('Oper')) emojiInput.value = '🚀';
            else emojiInput.value = '🌐';
        }
    }
});

// 
document.getElementById('automationIcon').addEventListener('input', (e) => { // Updated ID
    const val = e.target.value.toLowerCase();
    if (emojiMap[val]) {
        e.target.value = emojiMap[val];
    }
});

// Polling
// setInterval(fetchAutomations, 5000); // Removido para evitar recriação do DOM e manter estado do toggle

// Initial Load
fetchData();

// Expose functions to window for onclick handlers in HTML strings
window.editAutomation = editAutomation;
window.deleteAutomation = deleteAutomation;
window.toggleAutomationActive = toggleAutomationActive;

// Event Listeners for Elements not present on initial load (or removed inline handlers)
document.addEventListener('DOMContentLoaded', () => {
    const refreshLogsBtn = document.getElementById('refreshLogsBtn');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', fetchLogs);
    }

    // Initial Auth UI check if already cached
    // onAuthStateChanged will fire automatically

    // Auth Alert Modal Event Listeners
    const authAlertModal = document.getElementById('authAlertModal');
    const authModalLoginBtn = document.getElementById('authModalLoginBtn');
    const closeAuthAlertBtn = document.getElementById('closeAuthAlertBtn');

    if (authModalLoginBtn) {
        authModalLoginBtn.addEventListener('click', () => {
            if (authAlertModal) authAlertModal.close();
            loginWithMicrosoft();
        });
    }

    if (closeAuthAlertBtn) {
        closeAuthAlertBtn.addEventListener('click', () => {
            if (authAlertModal) authAlertModal.close();
        });
    }

    const authModalRequestAccessBtn = document.getElementById('authModalRequestAccessBtn');
    if (authModalRequestAccessBtn) {
        authModalRequestAccessBtn.addEventListener('click', () => {
            if (authAlertModal) authAlertModal.close();
            openAccessRequestModal();
        });
    }

    if (authAlertModal) {
        authAlertModal.addEventListener('click', (e) => {
            if (e.target === authAlertModal) {
                authAlertModal.close();
            }
        });
    }
});
