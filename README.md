# Agente de Monitoramento

Aplicação de monitoramento de automações e serviços, desenvolvida com FastAPI e JavaScript Vanilla.

## 🚀 Funcionalidades

- **Monitoramento de Status:** Verifica o status code de aplicações web.
- **Painel de Controle:** Interface visual para gerenciar e visualizar automações.
- **Logs:** Sistema de logs interno para acompanhar eventos e erros.
- **Integração com GitHub:** Visualização de repositórios e membros da organização.
- **Categorização:** Organização de automações por projetos/áreas.
- **Modo Dark/Light:** Interface moderna e responsiva.

## 🛠️ Tecnologias

- **Backend:** Python + FastAPI
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Armazenamento:** Firestore (projeto Firebase `tig-ai`)
- **Autenticação:** Firebase Auth com login Microsoft (tenant da Tigre)

## 📦 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/agente-monitoramento.git
cd agente-monitoramento
```

2. Crie um ambiente virtual (recomendado):
```bash
python -m venv venv
# Windows
venv\Scripts\activate
```

3. Instale as dependências:
```bash
pip install -r requirements.txt
```

## ▶️ Como Executar

1. Inicie o servidor:
```bash
python main.py
```

2. Acesse a aplicação no navegador:
```
http://127.0.0.1:8001
```

## 📁 Estrutura de Pastas

- `/static`: Arquivos do frontend (HTML, CSS, JS).
- `main.py`: Ponto de entrada da aplicação FastAPI.
- `monitor.py`: Lógica de monitoramento em background.
- `storage.py`: Inicialização do Firebase Admin e acesso ao Firestore.
- `set_admin.py`: Aplica o papel (`admin`/`colaborador`) a um usuário via Admin SDK.

## 🔐 Configuração

Copie `.env.example` para `.env`. O backend usa `serviceAccountKey.json` na raiz, se existir; senão cai para as credenciais do gcloud (`gcloud auth application-default login`). O frontend lê a configuração do Firebase em `static/config.js` (fora do git).

### Solicitação de acesso

Na tela de login, o botão **Solicitar acesso** abre um modal onde o visitante informa o e-mail; o backend (`access_request.py`, rota pública `POST /api/access-request`) valida que o domínio é da Tigre (`@tigre.com`) e envia um chamado por e-mail para `suporterobbi9@biti9.com.br`, usando a lib padrão da Biti9 (`mail_utils`, via Microsoft Graph). As variáveis (`GRAPH_API_*`, `MAIL_NOTIFICATION_ACCOUNT`, e as opcionais `ACCESS_REQUEST_*`) estão no `.env.example`. Há limite de uma solicitação por e-mail a cada 10 min e 30 por hora no total.

