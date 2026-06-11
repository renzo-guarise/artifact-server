# artifact-server

Servidor HTTP para desplegar artefactos HTML desde skills de Claude Code.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/deploy` | Bearer token | Sube un artefacto HTML, devuelve `{ id, url }` |
| `GET` | `/:id` | — | Sirve el artefacto público |
| `GET` | `/` | Bearer token | Lista todos los artefactos |
| `DELETE` | `/:id` | Bearer token | Elimina un artefacto |

## Deploy en VPS

### 1. Copiar al servidor

```bash
scp -r artifact-server/ user@tu-vps:/opt/artifact-server
```

### 2. Instalar dependencias

```bash
ssh user@tu-vps
cd /opt/artifact-server
npm install
```

### 3. Configurar env

```bash
cp .env.example .env
nano .env
```

```
PORT=3456
ARTIFACT_TOKEN=<token-secreto-largo>
BASE_URL=https://tu-dominio.com
```

### 4. Correr con PM2

```bash
npm install -g pm2
pm2 start server.js --name artifact-server --env production
pm2 save
pm2 startup
```

### 5. Nginx reverse proxy (opcional)

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3456;
        proxy_set_header Host $host;
    }
}
```

## Uso desde Claude Code

Setear en el shell local:

```bash
export ARTIFACT_TOKEN="tu-token-secreto"
export ARTIFACT_SERVER_URL="https://tu-dominio.com"
```

Luego invocar el skill con `/deploy-artifact` y describir qué generar.
