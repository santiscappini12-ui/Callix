# Videollamadas (WebRTC + Socket.io)

App simple de videollamadas por salas. Entrás con un nombre de sala,
compartís ese nombre con otra persona, y ambos quedan conectados por
video/audio en tiempo real (WebRTC), usando el servidor solo para la
señalización inicial.

## Probarlo en tu compu

```bash
npm install
npm start
```

Abrí `http://localhost:3000` en dos pestañas (o dos dispositivos en la
misma red usando tu IP local), poné el mismo nombre de sala en ambas,
y listo.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Primera version de la app de videollamadas"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

## Desplegar en Render

1. Entrá a [render.com](https://render.com) y creá una cuenta (podés usar tu GitHub).
2. Click en **New +** → **Web Service**.
3. Elegí el repo que acabás de subir.
4. Configuración:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (o el plan que uses)
5. Click en **Create Web Service**. Render te va a dar una URL tipo
   `https://tu-app.onrender.com`.

## Evitar que Render duerma el servidor (keep-alive)

Este repo ya incluye `.github/workflows/keep-alive.yml`, que le hace
ping a `/health` cada 10 minutos usando GitHub Actions.

Para activarlo:

1. En GitHub, andá a tu repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click en **New repository secret**.
3. Nombre: `RENDER_URL`
   Valor: `https://tu-app.onrender.com` (la URL real que te dio Render, **sin barra al final**)
4. Guardá. Andá a la pestaña **Actions** de tu repo: vas a ver el
   workflow "Keep Render Awake" listado. Podés correrlo manualmente
   con el botón "Run workflow" para probarlo, y después va a correr
   solo cada 10 minutos.

> Nota: el plan gratuito de Render duerme el servicio tras ~15 min sin
> tráfico. El ping cada 10 min evita eso. Igual, si nadie llamó al
> endpoint en un rato largo (ej. GitHub retrasó el cron), el primer
> ping después de dormido tarda 30-60 segundos en responder — es
> normal, es el "despertar" del servidor.

## Estructura del proyecto

```
videocall-app/
├── server.js              # Servidor Express + Socket.io (señalización WebRTC)
├── package.json
├── public/
│   └── index.html          # Frontend: pantalla de sala + video llamada
└── .github/workflows/
    └── keep-alive.yml       # Ping automático para que Render no duerma
```

## Limitaciones a tener en cuenta

- Usa servidores STUN públicos de Google. Si alguno de los dos está
  detrás de una red muy restrictiva (NAT simétrico, redes corporativas),
  puede que la conexión directa falle y haga falta un servidor TURN
  (no incluido acá, requiere infraestructura extra).
- No tiene autenticación: cualquiera que sepa el nombre de la sala
  puede entrar. Para uso personal/familiar está bien, pero no es apto
  para producción sin agregar seguridad.
