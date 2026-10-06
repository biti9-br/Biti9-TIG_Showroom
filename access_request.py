import asyncio
import html
import os
import re
import threading
import time
import traceback
from collections import deque
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv()

# --- Configuração de e-mail (padrão Biti9: lib mail_utils via Microsoft Graph) ---
# Mesmos nomes de variável dos projetos Robbi9, para reaproveitar as credenciais.
GRAPH_API_CLIENT_ID: str | None = os.environ.get("GRAPH_API_CLIENT_ID")
GRAPH_API_CLIENT_SECRET: str | None = os.environ.get("GRAPH_API_CLIENT_SECRET")
GRAPH_API_TENANT_ID: str | None = os.environ.get("GRAPH_API_TENANT_ID")
# Caixa que envia o e-mail (precisa existir no tenant do app registrado acima)
MAIL_NOTIFICATION_ACCOUNT: str = os.environ.get("MAIL_NOTIFICATION_ACCOUNT", "")


def _split_list(value: str) -> list[str]:
    """Separa uma lista em texto ("a@x.com; b@x.com", "a,b") em itens limpos."""
    return [item for item in value.replace(" ", "").replace(",", ";").split(";") if item]


# Destinatário do chamado de solicitação de acesso
ACCESS_REQUEST_MAIL_TO: list[str] = _split_list(
    os.environ.get("ACCESS_REQUEST_MAIL_TO", "suporterobbi9@biti9.com.br")
)
# Só e-mails destes domínios podem pedir acesso (comparação exata, sem subdomínios)
ACCESS_REQUEST_ALLOWED_DOMAINS: set[str] = {
    domain.lstrip("@").lower()
    for domain in _split_list(os.environ.get("ACCESS_REQUEST_ALLOWED_DOMAINS", "tigre.com"))
}

# Proteção contra abuso: a rota é pública (quem pede acesso ainda não tem conta)
EMAIL_COOLDOWN_SECONDS: int = 600  # mesmo e-mail só pode pedir de novo após 10 min
GLOBAL_LIMIT_PER_HOUR: int = 30  # teto de solicitações por hora para a caixa de suporte
_ONE_HOUR_SECONDS: int = 3600

_EMAIL_MAX_LENGTH: int = 254
_EMAIL_PATTERN = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}")
# Horário de Brasília (sem horário de verão desde 2019); evita depender de tzdata no container
_BRASILIA_TZ = timezone(timedelta(hours=-3))

_last_request_by_email: dict[str, float] = {}
_recent_requests: deque[float] = deque()

_mail_client = None
_mail_client_lock = threading.Lock()


class AccessRequestError(Exception):
    """Erro de negócio/técnico da solicitação, já com a mensagem e o status HTTP para o usuário."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _validate_email(raw_email: str) -> str:
    """Normaliza e valida o e-mail; só aceita os domínios de ACCESS_REQUEST_ALLOWED_DOMAINS."""
    email = (raw_email or "").strip().lower()
    if len(email) > _EMAIL_MAX_LENGTH or not _EMAIL_PATTERN.fullmatch(email):
        raise AccessRequestError(400, "Informe um e-mail válido.")

    domain = email.rsplit("@", 1)[1]
    if domain not in ACCESS_REQUEST_ALLOWED_DOMAINS:
        allowed = ", ".join(f"@{d}" for d in sorted(ACCESS_REQUEST_ALLOWED_DOMAINS))
        raise AccessRequestError(
            400, f"O acesso só pode ser solicitado para e-mails corporativos da Tigre ({allowed})."
        )
    return email


def _missing_mail_config() -> list[str]:
    """Nomes (nunca valores) das variáveis de e-mail que não foram configuradas."""
    required = {
        "GRAPH_API_CLIENT_ID": GRAPH_API_CLIENT_ID,
        "GRAPH_API_CLIENT_SECRET": GRAPH_API_CLIENT_SECRET,
        "GRAPH_API_TENANT_ID": GRAPH_API_TENANT_ID,
        "MAIL_NOTIFICATION_ACCOUNT": MAIL_NOTIFICATION_ACCOUNT,
        "ACCESS_REQUEST_MAIL_TO": ACCESS_REQUEST_MAIL_TO,
    }
    return [name for name, value in required.items() if not value]


def _reserve_slot(email: str) -> None:
    """Registra a solicitação ou levanta 429 se estiver acima dos limites.

    Roda sem `await` no meio, então é atômico dentro do event loop.
    """
    now = time.monotonic()
    for key in [k for k, t in _last_request_by_email.items() if now - t >= EMAIL_COOLDOWN_SECONDS]:
        del _last_request_by_email[key]
    while _recent_requests and now - _recent_requests[0] >= _ONE_HOUR_SECONDS:
        _recent_requests.popleft()

    if email in _last_request_by_email:
        raise AccessRequestError(
            429, "Já existe uma solicitação recente para este e-mail. Aguarde alguns minutos antes de tentar novamente."
        )
    if len(_recent_requests) >= GLOBAL_LIMIT_PER_HOUR:
        raise AccessRequestError(429, "Muitas solicitações no momento. Tente novamente mais tarde.")

    _last_request_by_email[email] = now
    _recent_requests.append(now)


def _get_mail_client():
    """Cria o GraphMailClient na primeira chamada (o construtor já busca o token) e reaproveita depois."""
    global _mail_client
    with _mail_client_lock:
        if _mail_client is None:
            # Import tardio: sem a lib/credenciais o app sobe normalmente e só esta rota fica indisponível
            from mail_utils import GraphMailClient

            _mail_client = GraphMailClient(
                client_id=GRAPH_API_CLIENT_ID,
                client_secret=GRAPH_API_CLIENT_SECRET,
                tenant_id=GRAPH_API_TENANT_ID,
            )
        return _mail_client


def _send_access_request_mail(email: str) -> None:
    """Envia o chamado ao suporte (bloqueante: chamar via asyncio.to_thread)."""
    from mail_utils import MailTemplateBiti9

    client = _get_mail_client()
    safe_email = html.escape(email)
    requested_at = datetime.now(_BRASILIA_TZ).strftime("%d/%m/%Y %H:%M:%S")
    subject = f"[Showroom Tigre] Solicitação de acesso - {email}"
    content = f"""
        <p>Olá, equipe de suporte,</p>
        <p>Foi solicitado acesso ao <strong>Showroom Tigre</strong> para o e-mail abaixo:</p>
        <p><strong>E-mail:</strong> <a href="mailto:{safe_email}">{safe_email}</a><br/>
        <strong>Data/hora da solicitação:</strong> {requested_at} (horário de Brasília)</p>
        <p>Por favor, providencie a liberação do acesso.</p>
    """

    client.send_email_using_template(
        account=MAIL_NOTIFICATION_ACCOUNT,
        subject=subject,
        template=MailTemplateBiti9(
            subject=html.escape(subject),
            header="Solicitação de acesso",
            content=content,
            preview=f"Solicitação de acesso ao Showroom Tigre para {safe_email}",
        ),
        recipients_to=ACCESS_REQUEST_MAIL_TO,
    )


async def request_access(raw_email: str) -> None:
    """Valida o e-mail e abre o chamado de acesso por e-mail para o suporte.

    Levanta AccessRequestError (com status HTTP e mensagem para o usuário) se o e-mail
    não for permitido, se os limites forem excedidos ou se o envio falhar.
    """
    email = _validate_email(raw_email)

    missing = _missing_mail_config()
    if missing:
        print(f"Solicitação de acesso indisponível: configuração de e-mail ausente ({', '.join(missing)})")
        raise AccessRequestError(503, "O envio de solicitações de acesso não está disponível no momento.")

    _reserve_slot(email)
    try:
        await asyncio.to_thread(_send_access_request_mail, email)
    except Exception as e:
        # Falha técnica: libera o e-mail para o usuário poder tentar de novo
        _last_request_by_email.pop(email, None)
        print(f"Erro ao enviar a solicitação de acesso para {email}: {e}")
        traceback.print_exc()
        raise AccessRequestError(
            502, "Não foi possível enviar a solicitação agora. Tente novamente em instantes."
        ) from e

    print(f"Solicitação de acesso enviada ao suporte: {email}")
