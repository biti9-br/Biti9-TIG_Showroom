# Importações de bibliotecas externas
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header  # Framework para criar a API e exceções HTTP
from fastapi.staticfiles import StaticFiles  # Para servir arquivos estáticos (HTML, CSS, JS)
from fastapi.responses import FileResponse, Response  # Para servir o config.js dinâmico
from fastapi.middleware.cors import CORSMiddleware  # Para lidar com CORS (Cross-Origin Resource Sharing)
from pydantic import BaseModel  # Para validação de dados e criação de modelos/schemas
from typing import Optional  # Para definir campos opcionais nos modelos
from uuid import uuid4  # Para gerar IDs únicos para as automações
from datetime import datetime  # Para trabalhar com datas e horários
from contextlib import asynccontextmanager  # Para o ciclo de vida (lifespan) da aplicação
import uvicorn  # Servidor ASGI para executar a aplicação FastAPI
import os  # Para interagir com o sistema de arquivos
import json  # Para montar o config.js a partir das variáveis de ambiente
from firebase_admin import firestore, auth # Para utilizar o Firestore e Auth
# Importações de módulos locais
from storage import (
    get_automations, save_automation, delete_automation,
    get_logs, add_log, get_projects, create_project, update_project, delete_project,
    db, _serialize_firestore_doc
)
from monitor import monitor
from access_request import request_access, AccessRequestError

# Ciclo de vida: inicia o monitor ao subir e o encerra ao desligar
@asynccontextmanager
async def lifespan(app: FastAPI):
    monitor.start()
    yield
    monitor.stop()
    await monitor.close()

app = FastAPI(lifespan=lifespan)

# Configuração de CORS (Cross-Origin Resource Sharing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependência para verificar o Token do Firebase
async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token não fornecido ou inválido")
    
    token = authorization.split("Bearer ")[1]
    try:
        # Valida o token com o Firebase Admin SDK
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {str(e)}")

# Como get_current_user, mas para rotas públicas: sem token válido, trata como visitante (None)
async def get_optional_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split("Bearer ")[1]
    try:
        return auth.verify_id_token(token)
    except Exception as e:
        print(f"Token inválido em rota pública, tratando como visitante: {e}")
        return None

# Modelo para criar um projeto
class ProjectRequest(BaseModel):
    name: str

# Modelo para atualizar um projeto
class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None

# Modelo para reordenar projetos em lote
class ReorderProjectsRequest(BaseModel):
    order: list[str]  # Lista de IDs na nova ordem

# Modelo para definir role
class SetRoleRequest(BaseModel):
    uid: str
    role: str

# Modelo para ativar/inativar uma automação
class SetActiveRequest(BaseModel):
    active: bool

# Modelo para solicitar acesso (visitante sem conta)
class AccessRequest(BaseModel):
    email: str

# Modelo para criar/atualizar uma automação (Firestore schema)
class AutomationRequest(BaseModel):
    name: str
    url: str
    projectId: Optional[str] = None
    projectName: Optional[str] = None
    icon: Optional[str] = "url_do_icone"
    isFeatured: bool = False
    shortDescription: Optional[str] = None
    creator: Optional[str] = ""
    tool: Optional[str] = ""
    aiApisUsed: Optional[list[str]] = []
    # Retirados: emoji, description (como solicitado pelo usuário)

class Automation(AutomationRequest):
    id: str
    lastChecked: Optional[str] = None
    statusCode: Optional[int] = None
    status: Optional[str] = "pending"
    insertedAt: str
    createdAt: str
    createdBy: str

# Endpoint: Listar todas as automações
@app.get("/api/automations")
async def read_automations(user_info: Optional[dict] = Depends(get_optional_user)):
    try:
        automations = await get_automations()
        # Apps inativos só aparecem para admin. O filtro é aqui porque a rota é pública
        # (esconder só no front ainda deixaria os dados saírem na API).
        # Apps antigos, sem o campo "active", contam como ativos.
        if not (user_info and user_info.get("role") == "admin"):
            automations = [a for a in automations if a.get("active", True)]
        return automations
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

# Endpoint: Criar uma nova automação
@app.post("/api/automations")
async def create_automation_api(req: AutomationRequest, background_tasks: BackgroundTasks, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")

    auto_id = str(uuid4())

    new_auto = {
        "name": req.name,
        "url": req.url,
        "projectId": req.projectId,
        "projectName": req.projectName,
        "icon": req.icon,
        "isFeatured": req.isFeatured,
        "shortDescription": req.shortDescription,
        "creator": req.creator,
        "tool": req.tool,
        "aiApisUsed": req.aiApisUsed,
        "active": True,
        "status": "pending",
        "lastChecked": None,
        "statusCode": None,
        "insertedAt": firestore.SERVER_TIMESTAMP,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "createdBy": user_email
    }

    # 🔹 Salva no Firestore
    await save_automation(auto_id, new_auto)

    # 🔹 Adiciona log de auditoria
    await add_log({
        "message": f"Usuário {user_email} criou a automação {req.name}",
        "type": "success"
    })

    doc_ref = db.collection("automations").document(auto_id)
    doc_snap = await doc_ref.get()
    saved_doc = _serialize_firestore_doc(doc_snap.to_dict())
    saved_doc["id"] = auto_id

    # Passamos o ID para o monitor
    background_tasks.add_task(monitor.check_automation, saved_doc)
    
    return saved_doc

# Endpoint: Atualizar uma automação existente
@app.put("/api/automations/{auto_id}")
async def update_automation_api(auto_id: str, req: AutomationRequest, background_tasks: BackgroundTasks, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")

    # Lê o estado atual para não checar a URL de um app inativo (o campo "active" não é alterado aqui)
    current_snap = await db.collection("automations").document(auto_id).get()
    is_active = (current_snap.to_dict() or {}).get("active", True)

    # Prepara dados para atualização
    update_data = {
        "name": req.name,
        "url": req.url,
        "projectId": req.projectId,
        "projectName": req.projectName,
        "icon": req.icon,
        "isFeatured": req.isFeatured,
        "shortDescription": req.shortDescription,
        "creator": req.creator,
        "tool": req.tool,
        "aiApisUsed": req.aiApisUsed
    }
    
    await save_automation(auto_id, update_data)
    
    await add_log({
        "message": f"usuario {user_email} alterou a automação {req.name}",
        "type": "info"
    })
    
    # Busca dados completos para o monitor
    update_data["id"] = auto_id
    if is_active:
        background_tasks.add_task(monitor.check_automation, update_data)

    return update_data

# Endpoint: Listar todos os projetos
@app.get("/api/projects")
async def read_projects_api():
    return await get_projects()

@app.post("/api/projects")
async def create_project_api(req: ProjectRequest, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")
    project = await create_project(req.name, created_by=user_email)
    if project:
        await add_log({
            "message": f"usuario {user_email} criou o projeto {req.name}",
            "type": "success"
        })
        return {"status": "success", "project": project}
    return {"status": "error", "message": "Falha ao criar projeto"}

@app.put("/api/projects/{project_id}")
async def update_project_api(project_id: str, req: UpdateProjectRequest, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")
    update_data = {}
    if req.name is not None:
        update_data["name"] = req.name
        update_data["slug"] = __import__('re').sub(r'[\s_-]+', '-', req.name.lower().strip())
    if req.order is not None:
        update_data["order"] = req.order
    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")
    await update_project(project_id, update_data)
    await add_log({"message": f"admin {user_email} atualizou o projeto {project_id}", "type": "info"})
    return {"status": "success"}

@app.post("/api/projects/reorder")
async def reorder_projects_api(req: ReorderProjectsRequest, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")
    for idx, project_id in enumerate(req.order):
        await update_project(project_id, {"order": idx})
    await add_log({"message": f"admin {user_email} reordenou os projetos", "type": "info"})
    return {"status": "success"}

@app.delete("/api/projects/{project_id}")
async def delete_project_api(project_id: str, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")
    await delete_project(project_id)
    await add_log({"message": f"admin {user_email} excluiu o projeto {project_id}", "type": "warning"})
    return {"status": "success"}

# Endpoint: Remover uma automação
@app.delete("/api/automations/{auto_id}")
async def delete_automation_api(auto_id: str, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")
    await delete_automation(auto_id)
    await add_log({
        "message": f"usuario {user_email} excluiu uma automação",
        "type": "warning"
    })
    return {"status": "success"}

# Endpoint: Ativar/inativar uma automação (apenas admin)
@app.patch("/api/automations/{auto_id}/active")
async def set_automation_active_api(auto_id: str, req: SetActiveRequest, background_tasks: BackgroundTasks, user_info: dict = Depends(get_current_user)):
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    user_email = user_info.get("email", "sistema")

    doc_ref = db.collection("automations").document(auto_id)
    doc_snap = await doc_ref.get()
    if not doc_snap.exists:
        raise HTTPException(status_code=404, detail="Automação não encontrada")

    try:
        await doc_ref.update({"active": req.active})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao alterar status da automação: {str(e)}")

    auto = _serialize_firestore_doc(doc_snap.to_dict())
    action = "ativou" if req.active else "inativou"
    await add_log({
        "message": f"admin {user_email} {action} a automação {auto.get('name', auto_id)}",
        "type": "info"
    })

    if req.active:
        # O monitor ignora apps inativos, então o status ficou desatualizado: checa a URL agora
        auto["id"] = auto_id
        auto["active"] = True
        background_tasks.add_task(monitor.check_automation, auto)

    return {"status": "success", "active": req.active}

# Endpoint: Listar todos os logs
@app.get("/api/logs")
async def read_logs(user_info: dict = Depends(get_current_user)):
    return await get_logs()

# Endpoint: Solicitar acesso (público: quem pede ainda não tem conta)
# Abre um chamado por e-mail para o suporte; só aceita e-mails dos domínios da Tigre.
@app.post("/api/access-request")
async def request_access_api(req: AccessRequest):
    try:
        await request_access(req.email)
    except AccessRequestError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return {"status": "success"}

# --- Admin Section ---

@app.get("/api/admin/users")
async def list_users_api(user_info: dict = Depends(get_current_user)):
    # Verifica se é admin
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    
    try:
        users = []
        page = auth.list_users()
        while page:
            for user in page.users:
                # Pega a role dos custom claims
                role = user.custom_claims.get('role', 'colaborador') if user.custom_claims else 'colaborador'
                users.append({
                    "uid": user.uid,
                    "email": user.email,
                    "displayName": user.display_name,
                    "role": role
                })
            page = page.get_next_page()
        return users
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao listar usuários: {str(e)}")

@app.post("/api/admin/set-role")
async def set_user_role_api(req: SetRoleRequest, user_info: dict = Depends(get_current_user)):
    # Verifica se quem está chamando é admin
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso negado: Administradores apenas")
    
    if req.role not in ["admin", "colaborador"]:
         raise HTTPException(status_code=400, detail="Role inválida. Use 'admin' ou 'colaborador'")
    
    try:
        # Define os custom claims para o usuário
        auth.set_custom_user_claims(req.uid, {"role": req.role})
        
        # Log de auditoria
        admin_email = user_info.get("email", "admin")
        await add_log({
            "message": f"admin {admin_email} alterou role do usuario {req.uid} para {req.role}",
            "type": "info"
        })
        
        return {"status": "success", "message": f"Role '{req.role}' aplicada com sucesso"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao definir role: {str(e)}")

# Config do front-end (window.APP_CONFIG). Em deploy por container o static/config.js
# não existe (é ignorado pelo git), então ele é montado das variáveis de ambiente.
# Sem elas, cai no arquivo static/config.js (uso local). Deve vir antes do mount "/".
FIREBASE_WEB_ENV = {
    "apiKey": "FIREBASE_API_KEY",
    "authDomain": "FIREBASE_AUTH_DOMAIN",
    "projectId": "FIREBASE_PROJECT_ID",
    "storageBucket": "FIREBASE_STORAGE_BUCKET",
    "messagingSenderId": "FIREBASE_MESSAGING_SENDER_ID",
    "appId": "FIREBASE_APP_ID",
}

@app.get("/config.js", include_in_schema=False)
async def frontend_config():
    firebase_cfg = {key: os.environ.get(var) for key, var in FIREBASE_WEB_ENV.items()}
    if all(firebase_cfg.values()):
        cfg = {"firebase": firebase_cfg, "msTenantId": os.environ.get("MS_TENANT_ID") or None}
        return Response(
            "window.APP_CONFIG = " + json.dumps(cfg) + ";",
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )
    if os.path.exists("static/config.js"):
        return FileResponse("static/config.js", media_type="application/javascript")
    missing = [var for key, var in FIREBASE_WEB_ENV.items() if not firebase_cfg[key]]
    raise HTTPException(status_code=404, detail=f"config.js indisponível: defina {', '.join(missing)}")

# Arquivos estáticos (deve vir após as rotas da API para evitar conflitos)
if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)
