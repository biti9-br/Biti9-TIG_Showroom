# Graph Report - Biti9-TIG_Showroom  (2026-09-21)

## Corpus Check
- Corpus is ~7,874 words - fits in a single context window. You may not need a graph.

## Summary
- 181 nodes · 314 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 1% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.83)
- Token cost: 60,000 input · 19,255 output

## Community Hubs (Navigation)
- Backend API & Storage
- Frontend UI State & Modals
- HTML Modal Structure
- Docs & Dependencies Overview
- Background Monitoring Loop
- Auth Session & Logs Rendering
- GitHub Integration
- Automation CRUD & Admin Users
- Project Management UI
- Firebase Package Config
- FastAPI Lifecycle Events

## God Nodes (most connected - your core abstractions)
1. `Biti9 Showroom - index.html` - 15 edges
2. `README.md (Agente de Monitoramento)` - 14 edges
3. `add_log()` - 12 edges
4. `Monitor` - 10 edges
5. `getAuthHeaders()` - 9 edges
6. `_serialize_firestore_doc()` - 9 edges
7. `create_automation_api()` - 7 edges
8. `fetchData()` - 7 edges
9. `renderProjectTabs()` - 7 edges
10. `get_automations()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Armazenamento em Arquivos JSON` --semantically_similar_to--> `google-cloud-firestore (dependency)`  [INFERRED] [semantically similar]
  README.md → requirements.txt
- `Biti9 Showroom - index.html` --conceptually_related_to--> `Painel de Controle`  [INFERRED]
  static/index.html → README.md
- `fastapi (dependency)` --conceptually_related_to--> `FastAPI (Backend)`  [INFERRED]
  requirements.txt → README.md
- `Logs dos Apps Modal` --conceptually_related_to--> `Sistema de Logs`  [INFERRED]
  static/index.html → README.md
- `Editar Projetos Modal` --conceptually_related_to--> `Categorização de Automações`  [INFERRED]
  static/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modal Dialog UI Pattern** — static_index_automationmodal, static_index_logsmodal, static_index_sessionexpiredmodal, static_index_usermanagementmodal, static_index_authalertmodal, static_index_projectmanagementmodal [INFERRED 0.85]
- **Core Application Architecture (FastAPI backend)** — main, monitor, storage, readme_doc [EXTRACTED 1.00]
- **Firebase/Firestore Data & Auth Integration** — requirements_google_cloud_firestore, requirements_firebase_admin, storage, static_index_authcontainer [INFERRED 0.65]

## Communities (11 total, 1 thin omitted)

### Community 0 - "Backend API & Storage"
Cohesion: 0.11
Nodes (42): Any, BackgroundTasks, BaseModel, delete, get, Automation, AutomationRequest, create_automation_api() (+34 more)

### Community 1 - "Frontend UI State & Modals"
Cohesion: 0.04
Nodes (40): addBtn, addProjectBtn, app, auth, automationIdInput, automationModal, automationNameInput, automationProjectSelect (+32 more)

### Community 2 - "HTML Modal Structure"
Cohesion: 0.10
Nodes (23): Categorização de Automações, Sistema de Logs, Login Necessário Modal, Auth Container (Login button area), authModalLoginBtn button, Nova Automação Modal (Add/Edit Automation Dialog), Automations Grid, Biti9 Showroom - index.html (+15 more)

### Community 3 - "Docs & Dependencies Overview"
Cohesion: 0.10
Nodes (20): /data directory (local JSON storage), README.md (Agente de Monitoramento), FastAPI (Backend), Integração com GitHub, JavaScript Vanilla (Frontend), Armazenamento em Arquivos JSON, Modo Dark/Light, Monitoramento de Status (+12 more)

### Community 5 - "Auth Session & Logs Rendering"
Cohesion: 0.22
Nodes (9): checkSessionExpiration(), createAutomationCard(), fetchLogs(), loginWithMicrosoft(), logout(), renderAutomations(), renderLogs(), setActiveProject() (+1 more)

### Community 6 - "GitHub Integration"
Cohesion: 0.29
Nodes (7): addProject(), fetchData(), fetchGitHubMembers(), fetchGitHubRepos(), fetchProjects(), renderGitHubMembers(), renderGitHubRepos()

### Community 7 - "Automation CRUD & Admin Users"
Cohesion: 0.38
Nodes (7): deleteAutomation(), fetchAdminUsers(), fetchAutomations(), getAuthHeaders(), renderAdminUsers(), saveAutomation(), updateUserRole()

### Community 8 - "Project Management UI"
Cohesion: 0.53
Nodes (6): deleteProjectFromModal(), renameProject(), renderProjectManagementList(), renderProjectsSelect(), renderProjectTabs(), updateTabsArrows()

### Community 9 - "Firebase Package Config"
Cohesion: 0.50
Nodes (3): firebase, dependencies, firebase

### Community 10 - "FastAPI Lifecycle Events"
Cohesion: 0.67
Nodes (3): shutdown_event(), startup_event(), on_event

## Ambiguous Edges - Review These
- `monitor.py` → `app.js (main frontend script)`  [AMBIGUOUS]
  static/index.html · relation: shares_data_with
- `Login Necessário Modal` → `loginBtn button`  [AMBIGUOUS]
  static/index.html · relation: references

## Knowledge Gaps
- **57 isolated node(s):** `firebase`, `firebaseConfig`, `app`, `auth`, `db` (+52 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `monitor.py` and `app.js (main frontend script)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `Login Necessário Modal` and `loginBtn button`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `Biti9 Showroom - index.html` connect `HTML Modal Structure` to `Docs & Dependencies Overview`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `README.md (Agente de Monitoramento)` connect `Docs & Dependencies Overview` to `Backend API & Storage`, `HTML Modal Structure`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `app.js (main frontend script)` connect `Docs & Dependencies Overview` to `HTML Modal Structure`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `firebase`, `firebaseConfig`, `app` to the rest of the system?**
  _57 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend API & Storage` be split into smaller, more focused modules?**
  _Cohesion score 0.10808080808080808 - nodes in this community are weakly interconnected._