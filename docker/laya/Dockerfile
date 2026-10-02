# Self-hosted Laya decision service for Recall (CPU). Build and run with:
#   docker compose -f compose.laya.yaml up -d --build
# If your network intercepts TLS, drop the root certificate as a .crt file in docker/laya/certs/ first.
FROM python:3.12-slim
COPY certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    PIP_NO_CACHE_DIR=1
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install "laya[serve]==0.3.23"
RUN useradd --create-home laya
USER laya
# The model cache volume inherits this directory's ownership on first use.
RUN mkdir -p /home/laya/.cache/huggingface
ENV LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_DEVICE=cpu LAYA_MODELS=english LAYA_PRELOAD=1
EXPOSE 8000
CMD ["laya-serve"]
