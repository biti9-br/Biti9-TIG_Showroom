# syntax=docker/dockerfile:1
# Use the official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.10-slim

# Allow statements and log messages to immediately appear in the Knative logs
ENV PYTHONUNBUFFERED=True

# Copy local code to the container image.
ENV APP_HOME=/app
WORKDIR $APP_HOME
COPY . ./

# git é necessário para instalar mail_utils (dependência via git+https no requirements.txt).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies.
# O PAT do Azure DevOps (repositório privado Lib_mail) entra como secret do BuildKit
# (--secret id=azure_pat): fica só durante este RUN, não vai para a imagem nem para o histórico.
RUN --mount=type=secret,id=azure_pat \
    set -eu; \
    [ -s /run/secrets/azure_pat ] || { echo "Secret azure_pat ausente: passe --secret id=azure_pat,src=<arquivo com o PAT>" >&2; exit 1; }; \
    export GIT_CONFIG_GLOBAL=/tmp/azure-gitconfig; \
    trap 'rm -f /tmp/azure-gitconfig' EXIT; \
    printf '[url "https://biti9:%s@dev.azure.com/"]\n\tinsteadOf = https://dev.azure.com/\n' "$(cat /run/secrets/azure_pat)" > "$GIT_CONFIG_GLOBAL"; \
    pip install --no-cache-dir -r requirements.txt

# Run the web service on container startup.
# Use gunicorn as the process manager with uvicorn workers.
CMD exec gunicorn --bind :${PORT:-8080} --workers 1 --worker-class uvicorn.workers.UvicornWorker --threads 8 main:app
