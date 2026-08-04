import { Telegraf } from 'telegraf';
import express from 'express';

const token = process.env.BOT_TOKEN;
const port = process.env.PORT || 3000;
const domain = process.env.RENDER_EXTERNAL_URL; // URL automática asignada por Render

if (!token) {
  console.error('Error: Debes proporcionar la variable de entorno BOT_TOKEN');
  process.exit(1);
}

const bot = new Telegraf(token);

// --- COMANDOS DEL BOT ---
bot.start((ctx) => ctx.reply(`¡Hola, ${ctx.from.first_name}! El bot está funcionando correctamente en Render.`));
bot.help((ctx) => ctx.reply('Envíame un mensaje y te responderé en eco.'));

// Respuesta a cualquier texto (Echo)
bot.on('text', (ctx) => {
  ctx.reply(`Dijiste: "${ctx.message.text}"`);
});

// --- CONFIGURACIÓN DE SERVIDOR Y DESPLIEGUE ---
const app = express();

if (domain) {
  // Configuración para RENDER (Modo Webhook)
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  
  app.use(await bot.createWebhook({ domain, path: webhookPath }));
  
  app.get('/', (req, res) => res.send('El bot está activo en Render!'));

  app.listen(port, () => {
    console.log(`Servidor de Webhook iniciado en el puerto ${port}`);
  });
} else {
  // Configuración para DESARROLLO LOCAL (Modo Polling)
  console.log('Iniciando bot en modo desarrollo local (Polling)...');
  bot.launch();

  // Cierre limpio en local
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
