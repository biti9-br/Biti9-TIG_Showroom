# Pendências: migração do Showroom para o Firebase da Tigre

_Atualizado em 02/10/2026. A migração está funcionando de ponta a ponta; sobram só ajustes menores e a parte de produção._

## Estado atual

| Item | Status |
|---|---|
| Projeto Firebase `TIG-AI` (`tig-ai`) | ✅ acesso liberado (meu papel: *Administrador de desenvolvimento de apps*) |
| Firestore `(default)` | ✅ leitura e gravação testadas pelo backend |
| Provedor de login Microsoft no Firebase | ✅ ativado |
| Domínios autorizados (`localhost`, `127.0.0.1`, `tig-ai.firebaseapp.com`, `tig-ai.web.app`) | ✅ ok |
| `static/config.js` apontando para o app Web `tig-ai-showroom` | ✅ feito (arquivo fora do git) |
| `storage.py` usando o projeto `tig-ai` explicitamente | ✅ feito |
| `.env` com `FIREBASE_PROJECT_ID=tig-ai` | ✅ feito (backend usa o meu login do gcloud por enquanto) |
| Consentimento de admin no Azure da Tigre | ✅ concedido; login com `biti9.andre@tigre.com` funciona |
| Tela de admin (listar usuários / definir papel) | ✅ acesso concedido no `tig-ai` + `gcloud auth application-default set-quota-project tig-ai` |
| Primeiro usuário admin | ✅ `set_admin.py` rodado em 02/10/2026 |
| Cadastro de projeto pela tela | ✅ testado em 02/10/2026 (só admin consegue, então confirma o papel) |

---

## Resolvido (registro)

- **Consentimento de admin no Azure:** app *TIG Showroom Entra ID SSO - PROD*, Client ID `990eaf03-b3fb-4d7f-903f-ef65ef36c87f`, tenant TIGRE S.A. (`963ca415-7dad-4569-b6df-554fbb071304`).
  - O login com `andre.michelli@biti9.com.br` **deve** falhar (erro AADSTS90072): o app aceita só contas do tenant da Tigre.
- **Auth admin sem chave JSON:** em vez de conta de serviço, foi dado acesso ao meu usuário no `tig-ai` e o projeto de cota do ADC foi trocado para `tig-ai`. Para produção ainda vale usar conta de serviço (ver seção 2).
- **Primeiro admin:** login uma vez no app, `python set_admin.py biti9.andre@tigre.com`, logout e login de novo.

### Como promover outro usuário a admin

O usuário precisa ter logado ao menos uma vez. Depois:

```powershell
.\.venv\Scripts\python.exe set_admin.py <email-ou-uid> [admin|colaborador]
```

(o `python` do PATH não tem o `firebase_admin`; usar o do `.venv`). O usuário precisa deslogar e logar de novo para o papel valer. Também dá para trocar o papel pela tela, em **Gerenciar Usuários**.

Para criar projetos sem passar pela tela: `.\.venv\Scripts\python.exe seed_projects.py "Nome 1" "Nome 2"`.

---

## 1. Ajustes menores

- [x] `README.md` dizia porta **8000**, mas o `main.py` sobe na **8001**. Corrigido.
- [x] Commitar as mudanças em `storage.py` e `.env.example` (o `config.js` e o `.env` ficam fora do git).
- [x] Trocar `@app.on_event` por `lifespan` no `main.py`.
- [ ] `node_modules/` e `graphify-out/` estão versionados no git (832 arquivos) e não estão no `.gitignore`. Tirar com `git rm -r --cached node_modules graphify-out` + acrescentar ao `.gitignore`.
- [ ] **A confirmar:** em 02/10/2026 o ícone do menu ☰ (que abre a gaveta com "Nova Automação", "Logs", "Gerenciar Usuários", "Editar Projetos") não apareceu no print da tela inicial. Suspeita: o `lucide.js` carregado do unpkg não carregou no navegador (na máquina do dev ele baixa normal). Conferir no F12 → Network. Se for isso, baixar o lucide para `static/vendor/` e fixar a versão em vez de `lucide@latest` no `index.html`.

## 2. Produção (mais pra frente)

- [ ] Definir onde vai rodar (Cloud Run? outro?) e adicionar o domínio em Authentication → Configurações → **Domínios autorizados**.
- [ ] No Cloud Run, preferir anexar a conta de serviço ao serviço em vez de usar arquivo de chave (hoje o backend local usa o login do gcloud do dev via ADC).
