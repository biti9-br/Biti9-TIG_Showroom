import asyncio  # Para criar e gerenciar loops assíncronos
import httpx  # Cliente HTTP assíncrono para fazer requisições externas
from datetime import datetime  # Para trabalhar com datas e horários
from storage import get_automations, save_automation, add_log, firestore

# Classe Monitor
class Monitor:
    def __init__(self):
        self.is_running = False  # Indica se o monitor está em execução
        self.client = None

    async def get_client(self):
        # Inicializa o cliente HTTP de forma preguiçosa no event loop correto
        if self.client is None or self.client.is_closed:
            self.client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
        return self.client

    async def check_url(self, url: str) -> dict:
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        try:
            client = await self.get_client()
            response = await client.get(url)
            return {
                "status_code": response.status_code,  # Retorna o código de status da resposta
                "is_online": 200 <= response.status_code < 400  # Verifica se a URL está online
            }
        except Exception as e:  # Em caso de erro, retorna um dicionário com o erro
            return {
                "status_code": 0,  # Código de status 0 indica erro
                "is_online": False,  # Indica que a URL não está online
                "error": str(e)  # Retorna a mensagem de erro
            }

    # Função para verificar uma automação e atualizar o status
    async def process_automation(self, auto: dict):
        # App inativo não é monitorado (apps antigos, sem o campo, contam como ativos)
        if not auto.get("active", True):
            return

        url = auto.get("url")
        if not url:
            return

        result = await self.check_url(url)
        
        # Verifica se o status ou status_code mudou
        old_status = auto.get("status", "unknown")
        old_status_code = auto.get("statusCode", None)
        
        new_status = "online" if result["is_online"] else "offline"
        new_status_code = result["status_code"]
        
        # Apenas atualiza a automação no Firestore se houver uma mudança de status
        # Isso economiza milhares de requisições de escrita desnecessárias
        if old_status != new_status or old_status_code != new_status_code:
            auto_id = auto.get("id")
            if auto_id:
                update_data = {
                    "status": new_status,
                    "lastChecked": firestore.SERVER_TIMESTAMP,
                    "statusCode": new_status_code
                }
                await save_automation(auto_id, update_data)

    # Função para verificar uma automação específica imediatamente
    async def check_automation(self, auto: dict):
        await self.process_automation(auto)

    # Função para iniciar o monitor
    async def run_checks(self):
        print("Starting monitoring loop...")
        while self.is_running:
            try:
                automations = await get_automations()
                
                # Cria uma lista de tarefas para executar TODAS as checagens em paralelo
                # Assim, 100 urls levam quase o mesmo tempo que 1 url para serem verificadas
                tasks = [self.process_automation(auto) for auto in automations]
                if tasks:
                    await asyncio.gather(*tasks)
                    
            except Exception as e:
                print(f"Erro no loop de monitoramento: {e}")
            
            await asyncio.sleep(30) # Verifica a cada 30 segundos

    # Inicia as rotinas em background
    def start(self):
        self.is_running = True
        asyncio.create_task(self.run_checks())

    # Fecha o cliente http de forma assíncrona
    async def close(self):
        if self.client and not self.client.is_closed:
            await self.client.aclose()

    # Para o loop de monitoramento
    def stop(self):
        self.is_running = False
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.close())
        except Exception:
            pass

monitor = Monitor()
