# Use the official Python runtime image
FROM python:3.13 as builder

RUN mkdir /app
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1

ENV PYTHONUNBUFFERED=1 

RUN pip install --upgrade pip 
COPY requirements.txt  /app/
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app/
# RUN python manage.py collectstatic

FROM python:3.13 as api

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Dedicated unprivileged account, mirroring the "hcw" system user created by the
# Debian packaging. Fixed uid/gid so mounted volumes keep a predictable owner.
RUN groupadd --gid 1000 hcw \
    && useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin hcw

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/ /app/
WORKDIR /app

# /app stays root-owned and fully read-only for the runtime user: media are
# expected to be stored on S3, so nothing is ever written to the code tree.
# Without this, CPython tries to write .pyc files into the read-only code tree.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOME=/home/hcw

USER hcw
EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "core.asgi:application"]


FROM docker.io/nginxinc/nginx-unprivileged:1.28-bookworm as admin

COPY --from=builder /app/statics/ /usr/share/nginx/html/
COPY nginx /etc/nginx/templates/default.conf.template