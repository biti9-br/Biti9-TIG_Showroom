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
RUN pip install --no-cache-dir -r requirements.txt

# Run the web service on container startup.
# Use gunicorn as the process manager with uvicorn workers.
CMD exec gunicorn --bind :${PORT:-8080} --workers 1 --worker-class uvicorn.workers.UvicornWorker --threads 8 main:app
