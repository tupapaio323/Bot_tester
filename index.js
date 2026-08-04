import pkg from 'telegraf';
const { Telegraf, session, Scenes, Markup } = pkg;
import express from 'express';
import { createCanvas, loadImage } from 'canvas';
import path from 'path';

const token = process.env.BOT_TOKEN;
const port = process.env.PORT || 3000;
const domain = process.env.RENDER_EXTERNAL_URL;

if (!token) {
  console.error('Error: Debes proporcionar la variable de entorno BOT_TOKEN');
  process.exit(1);
}

// --- CONFIGURACIÓN DE LA ESCENA (PASO A PASO) ---
const plantillaWizard = new Scenes.WizardScene(
  'PLANTILLA_WIZARD',
  
  // Paso 1: Pedir Nombre
  async (ctx) => {
    ctx.wizard.state.datos = {}; // Contenedor de datos
    await ctx.reply('👋 ¡Hola! Vamos a generar tu plantilla.\n\nPor favor, ingresa tu **Nombre**:');
    return ctx.wizard.next();
  },

  // Paso 2: Recibir Nombre y Pedir Número
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return ctx.reply('Por favor envía un texto válido para el nombre.');
    }
    ctx.wizard.state.datos.nombre = ctx.message.text;
    await ctx.reply('Excelente. Ahora ingresa tu **Número de teléfono**:');
    return ctx.wizard.next();
  },

  // Paso 3: Recibir Número y Pedir Cantidad
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return ctx.reply('Por favor envía un texto válido para el número.');
    }
    ctx.wizard.state.datos.numero = ctx.message.text;
    await ctx.reply('Perfecto. Por último, ingresa la **Cantidad**:');
    return ctx.wizard.next();
  },

  // Paso 4: Recibir Cantidad y Mostrar Botón de Enviar
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return ctx.reply('Por favor envía un texto válido para la cantidad.');
    }
    ctx.wizard.state.datos.cantidad = ctx.message.text;

    const { nombre, numero, cantidad } = ctx.wizard.state.datos;

    // Resumen y botón inline
    await ctx.reply(
      `📌 **Resumen de datos:**\n\n` +
      `• **Nombre:** ${nombre}\n` +
      `• **Número:** ${numero}\n` +
      `• **Cantidad:** ${cantidad}\n\n` +
      `¿Deseas generar la imagen?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Generar y Enviar Plantilla', 'generar_plantilla')]
      ])
    );

    return ctx.wizard.next();
  }
);

// --- INICIALIZAR BOT Y ESCENAS ---
const stage = new Scenes.Stage([plantillaWizard]);
const bot = new Telegraf(token);

bot.use(session());
bot.use(stage.middleware());

// Comandos
bot.command('generar', (ctx) => ctx.scene.enter('PLANTILLA_WIZARD'));
bot.start((ctx) => ctx.reply('Usa el comando /generar para crear una plantilla personalizada.'));

// --- ACCIÓN DEL BOTÓN "ENVIAR" ---
bot.action('generar_plantilla', async (ctx) => {
  await ctx.answerCbQuery('Generando imagen, por favor espera...');
  await ctx.reply('🎨 Editando la plantilla...');

  try {
    // Extraer datos desde el estado de la escena de forma segura
    const { nombre, numero, cantidad } = ctx.wizard.state?.datos || ctx.scene.session.state?.datos || {};

    // 1. Cargar la imagen base desde la raíz del proyecto
    const imagePath = path.resolve('./plantilla1.png');
    const image = await loadImage(imagePath);

    // 2. Crear el lienzo con las dimensiones exactas de la imagen
    const canvas = createCanvas(image.width, image.height);
    const ctxCanvas = canvas.getContext('2d');

    // Dibuja la plantilla de fondo
    ctxCanvas.drawImage(image, 0, 0, image.width, image.height);

    // 3. Estilo del texto (Negro, grande y centrado)
    ctxCanvas.fillStyle = '#000000';
    ctxCanvas.font = 'bold 55px Arial';
    ctxCanvas.textAlign = 'center';
    ctxCanvas.textBaseline = 'middle';

    // 4. Puntos medios para el centrado
    const centerX = image.width / 2;
    const centerY = image.height / 2;
    const espaciado = 75; // Distancia entre renglones

    // 5. Estampar los datos centrados
    ctxCanvas.fillText(`Nombre: ${nombre}`, centerX, centerY - espaciado);
    ctxCanvas.fillText(`Número: ${numero}`, centerX, centerY);
    ctxCanvas.fillText(`Cantidad: ${cantidad}`, centerX, centerY + espaciado);

    // 6. Convertir a Buffer y enviar por Telegram
    const buffer = canvas.toBuffer('image/png');
    await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ ¡Aquí tienes tu plantilla generada!' });

    // Salir del flujo de la escena
    return ctx.scene.leave();

  } catch (error) {
    console.error('Error al generar la imagen:', error);
    await ctx.reply('❌ Ocurrió un error al cargar o generar la plantilla. Verifica que "plantilla1.png" existe en la raíz del proyecto.');
    return ctx.scene.leave();
  }
});

// --- CONFIGURACIÓN DE SERVIDOR (WEBHOOK EN RENDER / POLLING EN LOCAL) ---
const app = express();

if (domain) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(await bot.createWebhook({ domain, path: webhookPath }));
  app.get('/', (req, res) => res.send('Servidor activo en Render'));
  app.listen(port, () => console.log(`Servidor activo en puerto ${port}`));
} else {
  console.log('Modo desarrollo local...');
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
