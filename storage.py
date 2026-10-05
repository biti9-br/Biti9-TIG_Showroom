import os
import asyncio
import re
import firebase_admin
from firebase_admin import credentials
from typing import List, Dict, Any, Optional
from google.cloud import firestore
from google.api_core.datetime_helpers import DatetimeWithNanoseconds
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# Inicializa o Firebase Admin SDK
SERVICE_ACCOUNT_PATH = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "serviceAccountKey.json")
# Projeto explícito: com ADC de usuário o projeto não vem na credencial e poderia
# cair no projeto padrão do gcloud (ex: o da Biti9).
PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID") or None

try:
    if not firebase_admin._apps:
        options = {"projectId": PROJECT_ID} if PROJECT_ID else None
        if SERVICE_ACCOUNT_PATH and os.path.exists(SERVICE_ACCOUNT_PATH):
            print(f"Inicializando Firebase com arquivo: {SERVICE_ACCOUNT_PATH}")
            cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred, options)
        else:
            print("Inicializando Firebase com Application Default Credentials (ADC)")
            firebase_admin.initialize_app(options=options)

    # Mantemos o AsyncClient para compatibilidade com o resto do código assíncrono.
    # Ele não herda a credencial do firebase_admin, então repassamos a mesma
    # credencial e projeto (sem isso o arquivo de service account é ignorado).
    admin_app = firebase_admin.get_app()
    db = firestore.AsyncClient(
        project=admin_app.project_id,
        credentials=admin_app.credential.get_credential(),
    )
except Exception as e:
    print(f"Aviso: Não foi possível inicializar o Firebase Admin. Erro: {e}")
    db = None

COLLECTION_AUTOMATIONS = "automations"
COLLECTION_PROJECTS = "projects"
COLLECTION_LOGS = "logs"

def generate_slug(text: str) -> str:
    """Gera um slug amigável a partir de um texto."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    text = re.sub(r'^-+|-+$', '', text)
    return text

def _serialize_firestore_doc(doc_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Converte tipos do Firestore para tipos JSON serializáveis."""
    for key, value in doc_dict.items():
        if isinstance(value, DatetimeWithNanoseconds) or isinstance(value, datetime):
            doc_dict[key] = value.isoformat()
    return doc_dict

# Funções para automações
async def get_automations() -> List[Dict[str, Any]]:
    if not db:
        return []
    try:
        docs = db.collection(COLLECTION_AUTOMATIONS).stream()
        automations = []
        async for doc in docs:
            data = doc.to_dict()
            data['id'] = doc.id
            automations.append(_serialize_firestore_doc(data))
        return automations
    except Exception as e:
        print(f"Erro ao buscar automações: {e}")
        return []

async def save_automation(automation_id: str, data: Dict[str, Any]):
    if not db:
        return
    try:
        # Mapeamento para camelCase se necessário (já deve vir mapeado do main.py)
        await db.collection(COLLECTION_AUTOMATIONS).document(automation_id).set(data, merge=True)
    except Exception as e:
        print(f"Erro ao salvar automação {automation_id}: {e}")

async def delete_automation(automation_id: str):
    if not db:
        return
    try:
        await db.collection(COLLECTION_AUTOMATIONS).document(automation_id).delete()
    except Exception as e:
        print(f"Erro ao deletar automação {automation_id}: {e}")

# Funções para projetos
async def get_projects() -> List[Dict[str, Any]]:
    if not db:
        return []
    try:
        docs = db.collection(COLLECTION_PROJECTS).stream()
        projects = []
        async for doc in docs:
            data = doc.to_dict()
            data['id'] = doc.id
            projects.append(_serialize_firestore_doc(data))
        # Ordena por campo 'order' (se existir), depois por nome
        projects.sort(key=lambda p: (p.get('order', 9999), p.get('name', '')))
        return projects
    except Exception as e:
        print(f"Erro ao buscar projetos: {e}")
        return []

async def create_project(name: str, created_by: str = "system") -> Dict[str, Any]:
    if not db:
        return {}
    
    slug = generate_slug(name)
    
    # Verifica se já existe
    existing = await db.collection(COLLECTION_PROJECTS).where("slug", "==", slug).limit(1).get()
    if existing:
        return _serialize_firestore_doc(existing[0].to_dict())

    # Determina a próxima posição (order)
    all_docs = await db.collection(COLLECTION_PROJECTS).get()
    next_order = len(all_docs)

    new_project = {
        "name": name,
        "slug": slug,
        "active": True,
        "order": next_order,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "createdBy": created_by
    }
    
    doc_ref = await db.collection(COLLECTION_PROJECTS).add(new_project)
    _, ref = doc_ref
    
    created_doc = await ref.get()
    return _serialize_firestore_doc(created_doc.to_dict())

async def update_project(project_id: str, data: Dict[str, Any]):
    """Atualiza campos de um projeto (ex: name, slug, order)."""
    if not db:
        return
    try:
        await db.collection(COLLECTION_PROJECTS).document(project_id).update(data)
    except Exception as e:
        print(f"Erro ao atualizar projeto {project_id}: {e}")

async def delete_project(project_id: str):
    """Remove um projeto do Firestore."""
    if not db:
        return
    try:
        await db.collection(COLLECTION_PROJECTS).document(project_id).delete()
    except Exception as e:
        print(f"Erro ao deletar projeto {project_id}: {e}")

async def get_logs() -> List[Dict[str, Any]]:
    if not db:
        return []
    try:
        docs = db.collection(COLLECTION_LOGS).order_by("timestamp", direction=firestore.Query.DESCENDING).limit(20).stream()
        logs = []
        async for doc in docs:
            logs.append(_serialize_firestore_doc(doc.to_dict()))
        return logs
    except Exception as e:
        print(f"Erro ao buscar logs: {e}")
        return []

async def add_log(log_entry: Dict[str, Any]):
    if not db:
        return
    try:
        if "timestamp" not in log_entry or not log_entry["timestamp"]:
            log_entry["timestamp"] = firestore.SERVER_TIMESTAMP
        await db.collection(COLLECTION_LOGS).add(log_entry)
    except Exception as e:
        print(f"Erro ao adicionar log: {e}")

