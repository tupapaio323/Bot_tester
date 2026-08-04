import fs from 'fs';
import path from 'path';
import axios from 'axios';
import express from 'express';
import { Telegraf, session, Markup } from 'telegraf';
import { createCanvas, loadImage, registerFont } from 'canvas';
import jimp from 'jimp';
import jsQR from 'jsqr';

// ================== CONFIGURACIÓN ==================

const TOKEN = process.env.BOT_TOKEN || "8081387434:AAEgQsJRzhF36yxjREuOaWhUv8bglYdYE50";
const CANAL_ID = -1003526399267;
const CANAL_LINK = "https://t.me/+6fR_ZofaYwhkOWUx";
const PORT = process.env.PORT || 3000;

// Rutas de Plantillas (Ubicadas en la raíz del repositorio)
const PLANTILLA = path.resolve('./base1.png');
const PLANTILLA2 = path.resolve('./base2.png');
const PLANTILLA_QR1 = path.resolve('./qr1.png');
const PLANTILLA_QR2 = path.resolve('./qr2.png');
const PLANTILLA_LLAVE1 = path.resolve('./llave1.png');
const PLANTILLA_LLAVE2 = path.resolve('./llave2.png');
const PLANTILLA_BANCO1 = path.resolve('./banco1.png');
const PLANTILLA_BANCO2 = path.resolve('./banco2.png');
const PLANTILLA_BANCOL_AHORROS = path.resolve('./bancolombia1.png');

// Fuentes (Ubicadas en la raíz del repositorio)
const FUENTE_BANCOL = path.resolve('./bancolombia.ttf');
const FUENTE_BANCOL_SANS = path.resolve('./bancolombia_sans.ttf');
const FUENTE = path.resolve('./Manrope_Regular.ttf');

const COLOR_TEXTO = "#230620";
const RUTA_USUARIOS = path.resolve('./usuarios_bot.json');
const BRAND_NAME = "𝓖𝓲𝓯𝓽 𝓟𝓸𝔀𝓮𝓻𝓮𝓭";

// Tamaños de letra para los comprobantes (ajústalos aquí si ves las letras muy grandes o muy pequeñas)
// Cada comprobante tiene su propio tamaño de fuente, igual que en power.py
const FONT_SIZE = 200;        // Nequi a Nequi (base1)
const FONT_SIZE_BASE2 = 200;  // Nequi a Nequi (base2)
const FONT_SIZE_QR1 = 120;    // Nequi a QR Empresa (qr1)
const FONT_SIZE_QR2 = 120;    // Nequi a QR Empresa (qr2)
const FONT_SIZE_LLAVE1 = 120; // Nequi a Llave (llave1)
const FONT_SIZE_LLAVE2 = 120; // Nequi a Llave (llave2)
const FONT_SIZE_BANCO1 = 120; // Nequi a Bancol (banco1)
const FONT_SIZE_BANCO2 = 120; // Nequi a Bancol (banco2)
const FONT_SIZE_BANCOL = 110; // Bancolombia a Bancolombia (bancolombia1)
const CALIDAD_JPEG = 0.8;

// Registrar Fuentes en Canvas si existen
if (fs.existsSync(FUENTE)) registerFont(FUENTE, { family: 'Manrope' });
if (fs.existsSync(FUENTE_BANCOL)) registerFont(FUENTE_BANCOL, { family: 'BancolombiaFont' });
if (fs.existsSync(FUENTE_BANCOL_SANS)) registerFont(FUENTE_BANCOL_SANS, { family: 'BancolombiaSans' });

// ===================================================

const bot = new Telegraf(TOKEN);
bot.use(session());

// CAPTURADOR GLOBAL DE ERRORES EN TELEGRAF
bot.catch((err, ctx) => {
  console.error(`🔴 Error detectado en el bot (${ctx.updateType}):`, err);
});

// ---------- VALIDACIONES ----------
const validarNombre = (n) => n && n.trim().length > 2;
const validarNumeroNequi = (n) => /^\d{10}$/.test(n) && n.startsWith("3");
const validarCantidad = (c) => /^\d+$/.test(c) && parseInt(c, 10) >= 500;

// ---------- GESTIÓN DE USUARIOS ----------
function guardarUsuario(userId, nombre) {
  let usuarios = {};
  if (fs.existsSync(RUTA_USUARIOS)) {
    try {
      const contenido = fs.readFileSync(RUTA_USUARIOS, 'utf-8').trim();
      if (contenido) usuarios = JSON.parse(contenido);
    } catch (e) {
      usuarios = {};
    }
  }
  const uidStr = String(userId);
  if (!usuarios[uidStr]) {
    usuarios[uidStr] = { nombre };
    try {
      fs.writeFileSync(RUTA_USUARIOS, JSON.stringify(usuarios, null, 4));
    } catch (e) {}
  }
}

// ---------- LÓGICA ESCANEO QR ----------
function extraerNombre(texto) {
  const match1 = texto.match(/59(\d{2})(.+)/);
  if (match1) {
    const longitud = parseInt(match1[1], 10);
    const posibleNombre = match1[2].substring(0, longitud).trim();
    if (posibleNombre) return posibleNombre;
  }
  const match2 = texto.match(/([A-ZÁÉÍÓÚÑ0-9_]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9_]{2,}){1,3})/);
  if (match2) {
    const nombreCompuesto = match2[1].trim();
    if (!/^\d+$/.test(nombreCompuesto.replace(/\s+/g, ''))) return nombreCompuesto;
  }
  return null;
}

function extraerTelefono(texto) {
  const match = texto.match(/(\d{10})0703/);
  return match ? match[1] : null;
}

function extraerLlave(texto) {
  const m = texto.match(/CO\.COM\.RBM\.IVA503(\d{13,})/);
  if (m) {
    const bloque = m[1];
    const idx = bloque.indexOf('010');
    if (idx !== -1 && bloque.length >= idx + 3 + 10) {
      return '00' + bloque.substring(idx + 3, idx + 13);
    }
    if (bloque.length >= 15) return bloque.substring(5, 15);
  }
  const m2 = texto.match(/\b010(\d{10})\b/);
  if (m2) return '00' + m2[1];
  return null;
}

async function leerQR(buffer) {
  try {
    const image = await jimp.read(buffer);
    const qrCode = jsQR(
      new Uint8ClampedArray(image.bitmap.data),
      image.bitmap.width,
      image.bitmap.height
    );
    return qrCode ? [qrCode.data] : [];
  } catch (error) {
    return [];
  }
}

// ---------- CACHE DE PLANTILLAS ----------
// Carga cada plantilla una sola vez y la reutiliza, así la generación es mucho más rápida.
const cachePlantillas = new Map();
function obtenerImagen(ruta) {
  if (!cachePlantillas.has(ruta)) {
    cachePlantillas.set(ruta, loadImage(ruta));
  }
  return cachePlantillas.get(ruta);
}

// ---------- FUNCIONES COMPROBANTES ----------
function formatearCantidad(valor) {
  const num = parseInt(valor, 10);
  const formatted = num.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$ ${formatted}`;
}

function formatearNumero(numero) {
  if (!numero) return "";
  return `${numero.slice(0, 3)} ${numero.slice(3, 6)} ${numero.slice(6)}`;
}

async function generarComprobante(nombre, numero, cantidad, plantillaPath, referencia = null, llave = null, banco = null, origen = null) {
  const image = await obtenerImagen(plantillaPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0);

  if (!referencia) {
    referencia = "M1" + Array.from({ length: 7 }, () => Math.floor(Math.random() * 10)).join('');
  }

  const ahora = new Date();
  let fec = "";

  if (plantillaPath === PLANTILLA_BANCO1 || plantillaPath === PLANTILLA_BANCO2) {
    const mesesAbr = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const periodo = ahora.getHours() < 12 ? "A. M." : "P. M.";
    const h12 = ahora.getHours() % 12 || 12;
    fec = `${String(ahora.getDate()).padStart(2, '0')} De ${mesesAbr[ahora.getMonth()]} De ${ahora.getFullYear()}, ${String(h12).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} ${periodo}`;
  } else {
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const h12 = ahora.getHours() % 12 || 12;
    const periodo = ahora.getHours() < 12 ? "a. m." : "p. m.";
    fec = `${String(ahora.getDate()).padStart(2, '0')} de ${meses[ahora.getMonth()]} de ${ahora.getFullYear()} a las ${h12}:${String(ahora.getMinutes()).padStart(2, '0')} ${periodo}`;
  }

  const cantF = formatearCantidad(cantidad);

  let coords;
  if (plantillaPath === PLANTILLA2) coords = [[148, 2922], [144, 1700], [144, 1960], [144, 2187], [144, 2425], [145, 2665]];
  else if (plantillaPath === PLANTILLA_QR1) coords = [[215, 2555], [215, 1480], [215, 1762], null, [215, 2015], [213, 2270]];
  else if (plantillaPath === PLANTILLA_QR2) coords = [[144, 2682], [143, 1715], [145, 1955], null, [144, 2185], [143, 2430]];
  else if (plantillaPath === PLANTILLA_LLAVE1) coords = [[143, 3195], [143, 1490], [143, 2470], null, [143, 2213], [143, 2697]];
  else if (plantillaPath === PLANTILLA_LLAVE2) coords = [[143, 3410], [143, 1697], [143, 2680], null, [143, 2428], [143, 2915]];
  else if (plantillaPath === PLANTILLA_BANCO1) coords = [[143, 2967], [143, 1505], [143, 1760], null, [143, 1995], [143, 2715]];
  else if (plantillaPath === PLANTILLA_BANCO2) coords = [[143, 3162], [143, 1700], [143, 1963], null, [143, 2195], [143, 2913]];
  else coords = [[148, 3135], [150, 1820], [150, 2090], [148, 2340], [148, 2598], [150, 2860]];

  const [pEst, pNom, pCan, pNum, pFec, pRef] = coords;

  // Tamaño de fuente correspondiente según el comprobante (como en power.py)
  let fontTamano;
  if (plantillaPath === PLANTILLA2) fontTamano = FONT_SIZE_BASE2;
  else if (plantillaPath === PLANTILLA_QR1) fontTamano = FONT_SIZE_QR1;
  else if (plantillaPath === PLANTILLA_QR2) fontTamano = FONT_SIZE_QR2;
  else if (plantillaPath === PLANTILLA_LLAVE1) fontTamano = FONT_SIZE_LLAVE1;
  else if (plantillaPath === PLANTILLA_LLAVE2) fontTamano = FONT_SIZE_LLAVE2;
  else if (plantillaPath === PLANTILLA_BANCO1) fontTamano = FONT_SIZE_BANCO1;
  else if (plantillaPath === PLANTILLA_BANCO2) fontTamano = FONT_SIZE_BANCO2;
  else fontTamano = FONT_SIZE;

  ctx.fillStyle = COLOR_TEXTO;
  ctx.font = `${fontTamano}px Manrope`;
  ctx.textBaseline = "top";

  if (pEst) ctx.fillText("Disponible", pEst[0], pEst[1]);
  if (pNom) ctx.fillText(nombre, pNom[0], pNom[1]);
  if (pCan) ctx.fillText(cantF, pCan[0], pCan[1]);
  if (pFec) ctx.fillText(fec, pFec[0], pFec[1]);
  if (pRef) ctx.fillText(referencia, pRef[0], pRef[1]);
  if (pNum && numero) ctx.fillText(formatearNumero(numero), pNum[0], pNum[1]);

  if (plantillaPath === PLANTILLA_LLAVE1 || plantillaPath === PLANTILLA_LLAVE2) {
    ctx.fillText(String(llave), 143, plantillaPath === PLANTILLA_LLAVE1 ? 1727 : 1947);
    ctx.fillText(String(banco), 143, plantillaPath === PLANTILLA_LLAVE1 ? 1980 : 2192);
    ctx.fillText(String(origen), 143, plantillaPath === PLANTILLA_LLAVE1 ? 2950 : 3170);
  }

  return { buffer: canvas.toBuffer('image/jpeg', CALIDAD_JPEG), referencia };
}

async function generarComprobanteBancolAhorros(nombreDestino, cuentaDestino, valor) {
  const image = await obtenerImagen(PLANTILLA_BANCOL_AHORROS);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0);

  const ahora = new Date();
  const mesesAbr = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const periodo = ahora.getHours() < 12 ? "a. m." : "p. m.";
  const h12 = ahora.getHours() % 12 || 12;
  const fec = `${String(ahora.getDate()).padStart(2, '0')} ${mesesAbr[ahora.getMonth()]} ${ahora.getFullYear()} - ${String(h12).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} ${periodo}`;

  const randomDigitos = Array.from({ length: 2 }, () => Math.floor(Math.random() * 10)).join('');
  const referencia = `Comprobante No. 00000${randomDigitos}00`;
  const valorFormateado = formatearCantidad(valor);

  ctx.textBaseline = "top";

  // Valor
  ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
  ctx.font = `${FONT_SIZE_BANCOL}px BancolombiaFont`;
  ctx.fillText(valorFormateado, 200, 800);

  // Nombre
  ctx.font = `${FONT_SIZE_BANCOL}px BancolombiaSans`;
  ctx.fillText(nombreDestino, 200, 1000);

  // Cuenta
  ctx.fillText(cuentaDestino, 200, 1200);

  // Fecha y Referencia
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(fec, 200, 1400);
  ctx.fillText(referencia, 200, 1600);

  return { buffer: canvas.toBuffer('image/jpeg', CALIDAD_JPEG), referencia };
}

// ---------- MENÚS ----------
function menuPrincipal(nombre) {
  const nombreEsc = nombre.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const texto = `✨ <b>𝗛𝗢𝗟𝗔 ${nombreEsc}</b>\n\n🚀 ¿𝗤𝗨𝗘 𝗤𝗨𝗜𝗘𝗥𝗘𝗦 𝗛𝗔𝗖𝗘𝗥 𝗛𝗢𝗬?`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🧾 GENERAR COMPROBANTE", "generar")],
    [Markup.button.callback("🔍 ESCANEAR QR", "scan_qr")],
    [Markup.button.callback("📢 CANAL", "delay_canal")],
    [Markup.button.callback("❓ AYUDA", "delay_ayuda")]
  ]);
  return { texto, kb };
}

async function verificarCanal(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(CANAL_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

// ---------- COMANDOS Y ACCIONES ----------
bot.start(async (ctx) => {
  const user = ctx.from;
  guardarUsuario(user.id, `${user.first_name || ''} ${user.last_name || ''}`.trim());

  if (!(await verificarCanal(ctx, user.id))) {
    const texto = `<b>🚫 ACCESO BLOQUEADO</b>\n\n🔒 Debes unirte al canal oficial para usar el bot.`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.url("📢 UNIRME", CANAL_LINK)],
      [Markup.button.callback("✅ YA ME UNÍ", "verificar_canal")]
    ]);
    return ctx.replyWithHTML(texto, kb);
  }

  const nombre = user.username ? `@${user.username}` : user.first_name;
  const { texto, kb } = menuPrincipal(nombre);
  await ctx.replyWithHTML(texto, kb);
});

bot.action("generar", (ctx) => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🟣 NEQUI", "nequi")],
    [Markup.button.callback("🟡 BANCOLOMBIA", "bancol")],
    [Markup.button.callback("🔙 VOLVER", "back")]
  ]);
  return ctx.editMessageText("🧾 <b>GENERAR COMPROBANTE</b>\n\nSelecciona plataforma:", { parse_mode: "HTML", ...kb });
});

bot.action("nequi", (ctx) => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🟣 NEQUI A NEQUI", "n_n")],
    [Markup.button.callback("🟣 NEQUI A BANCOL", "n_bancol")],
    [Markup.button.callback("🟣 NEQUI A QR EMPRESA", "n_qr_empresa")],
    [Markup.button.callback("🟣 NEQUI A QR LLAVE", "n_qr_llave")],
    [Markup.button.callback("🟣 NEQUI A LLAVE PERSONA", "n_llave_persona")],
    [Markup.button.callback("🔙 VOLVER", "generar")]
  ]);
  return ctx.editMessageText("🟣 <b>OPCIONES NEQUI</b>:", { parse_mode: "HTML", ...kb });
});

bot.action("bancol", (ctx) => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🟡 BANCOL A BANCOL", "bancol_ahorros")],
    [Markup.button.callback("🔙 VOLVER", "generar")]
  ]);
  return ctx.editMessageText("🟡 <b>OPCIONES BANCOLOMBIA</b>:", { parse_mode: "HTML", ...kb });
});

bot.action("scan_qr", (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.esperando_qr = true;
  return ctx.editMessageText("📥 <b>MODO ESCÁNER</b>\n\nEnvía la foto del QR para extraer datos.", { parse_mode: "HTML" });
});

bot.action("back", (ctx) => {
  const user = ctx.from;
  const nombre = user.username ? `@${user.username}` : user.first_name;
  const { texto, kb } = menuPrincipal(nombre);
  return ctx.editMessageText(texto, { parse_mode: "HTML", ...kb });
});

bot.action(["n_n", "n_bancol", "n_qr_empresa", "n_qr_llave", "n_llave_persona"], (ctx) => {
  ctx.session = { variante: ctx.match[0], paso: "nombre", msg_id: ctx.callbackQuery.message.message_id };
  return ctx.editMessageText("🟣 Escribe el <b>NOMBRE / EMPRESA</b>:", { parse_mode: "HTML" });
});

bot.action("bancol_ahorros", (ctx) => {
  ctx.session = { variante: "bancol_ahorros", paso: "valor", msg_id: ctx.callbackQuery.message.message_id };
  return ctx.editMessageText("💰 Escribe el <b>VALOR DE LA TRANSFERENCIA</b>:", { parse_mode: "HTML" });
});

bot.action("delay_canal", (ctx) => {
  const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 VOLVER", "back")]]);
  return ctx.editMessageText(`📢 <b>CANAL</b>\n\nÚnete: ${CANAL_LINK}`, { parse_mode: "HTML", ...kb });
});

bot.action("verificar_canal", async (ctx) => {
  const user = ctx.from;
  if (await verificarCanal(ctx, user.id)) {
    await ctx.editMessageText("✅ ¡Bienvenido! Ya puedes usar el bot.", { parse_mode: "HTML" });
    const nombre = user.username ? `@${user.username}` : user.first_name;
    const { texto, kb } = menuPrincipal(nombre);
    await ctx.telegram.sendMessage(user.id, texto, { parse_mode: "HTML", ...kb });
  } else {
    await ctx.editMessageText("❌ Aún no te has unido. Intenta de nuevo.", { parse_mode: "HTML" });
  }
});

bot.action("delay_ayuda", (ctx) => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.url("💬 CHATEAR", "https://t.me/Shop_powered")],
    [Markup.button.callback("🔙 VOLVER", "back")]
  ]);
  return ctx.editMessageText("📖 <b>AYUDA</b>\n\n¿Tienes dudas? Chatea con nosotros:", { parse_mode: "HTML", ...kb });
});

// ---------- MANEJO DE MENSAJES DE TEXTO Y ARCHIVOS ----------
bot.on(['text', 'photo', 'document'], async (ctx) => {
  ctx.session = ctx.session || {};
  const chatId = ctx.chat.id;

  // Manejo de QR
  if (ctx.session.esperando_qr && (ctx.message.photo || ctx.message.document)) {
    const photo = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1] : ctx.message.document;
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const msgWait = await ctx.reply("🔍 Escaneando...");

    try {
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      const payloads = await leerQR(Buffer.from(response.data));

      if (payloads.length > 0) {
        const resp = [];
        for (const p of payloads) {
          const tel = extraerTelefono(p);
          const nom = extraerNombre(p);
          const lla = extraerLlave(p);
          let txt = `<b>📌 DATOS QR</b>\n`;
          if (lla) txt += `🔑 Llave: <code>${lla}</code>\n`;
          else if (tel) txt += `📞 Teléfono: <code>${tel}</code>\n`;
          if (nom) txt += `📜 Titular: ${nom}`;
          resp.push(txt);
        }
        await ctx.telegram.editMessageText(chatId, msgWait.message_id, null, `🔥 <b>${BRAND_NAME} SCAN</b> 🔥\n\n` + resp.join("\n\n"), { parse_mode: "HTML" });
      } else {
        await ctx.telegram.editMessageText(chatId, msgWait.message_id, null, "⚠️ No se detectó QR.");
      }
    } catch (e) {
      await ctx.telegram.editMessageText(chatId, msgWait.message_id, null, "⚠️ Error al procesar la imagen del QR.");
    } finally {
      ctx.session.esperando_qr = false;
    }
    return;
  }

  if (!ctx.session.paso) return;

  const paso = ctx.session.paso;
  const varType = ctx.session.variante;
  const texto = ctx.message.text;
  const msgId = ctx.session.msg_id;

  await ctx.deleteMessage().catch(() => {});

  if (paso === "nombre") {
    if (!validarNombre(texto)) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ Nombre muy corto. Escribe de nuevo:", { parse_mode: "HTML" });
    }
    ctx.session.nombre = texto.trim();
    if (["n_qr_llave", "n_llave_persona"].includes(varType)) {
      ctx.session.paso = "llave";
      return ctx.telegram.editMessageText(chatId, msgId, null, "🔑 Escribe la <b>LLAVE</b>:", { parse_mode: "HTML" });
    } else if (varType === "n_qr_empresa") {
      ctx.session.paso = "referencia";
      return ctx.telegram.editMessageText(chatId, msgId, null, "📝 Escribe la <b>REFERENCIA</b>:", { parse_mode: "HTML" });
    } else {
      ctx.session.paso = "numero";
      return ctx.telegram.editMessageText(chatId, msgId, null, "📲 Escribe el <b>NÚMERO</b>:", { parse_mode: "HTML" });
    }
  }

  if (paso === "llave") {
    ctx.session.llave = texto.trim();
    ctx.session.paso = "banco";
    return ctx.telegram.editMessageText(chatId, msgId, null, "🏦 Escribe el <b>BANCO DESTINO</b>:", { parse_mode: "HTML" });
  }

  if (paso === "banco") {
    ctx.session.banco = texto.trim();
    ctx.session.paso = "origen";
    return ctx.telegram.editMessageText(chatId, msgId, null, "📍 ¿De dónde se hizo el envío? (Ej: Nequi):", { parse_mode: "HTML" });
  }

  if (paso === "origen") {
    ctx.session.origen = texto.trim();
    ctx.session.paso = "cantidad";
    return ctx.telegram.editMessageText(chatId, msgId, null, "💰 Escribe la <b>CANTIDAD</b>:", { parse_mode: "HTML" });
  }

  if (paso === "numero") {
    if (!(validarNumeroNequi(texto) || varType === "n_bancol")) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ Número inválido. Intenta de nuevo:", { parse_mode: "HTML" });
    }
    ctx.session.numero = texto.trim();
    ctx.session.paso = "cantidad";
    return ctx.telegram.editMessageText(chatId, msgId, null, "💰 Escribe la <b>CANTIDAD</b>:", { parse_mode: "HTML" });
  }

  if (paso === "valor") {
    if (!validarCantidad(texto)) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ Valor mínimo $500. Escribe de nuevo:", { parse_mode: "HTML" });
    }
    ctx.session.valor = texto.trim();
    ctx.session.paso = "nombre_destino";
    return ctx.telegram.editMessageText(chatId, msgId, null, "👤 Escribe el <b>NOMBRE DESTINO</b>:", { parse_mode: "HTML" });
  }

  if (paso === "nombre_destino") {
    if (!validarNombre(texto)) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ Nombre muy corto. Escribe de nuevo:", { parse_mode: "HTML" });
    }
    ctx.session.nombre_destino = texto.trim();
    ctx.session.paso = "cuenta";
    return ctx.telegram.editMessageText(chatId, msgId, null, "🏦 Escribe la <b>CUENTA DESTINO</b> (11 dígitos):", { parse_mode: "HTML" });
  }

  if (paso === "cuenta") {
    const cuenta = texto.trim();
    if (!(/^\d{11}$/.test(cuenta))) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ La cuenta debe tener exactamente 11 dígitos. Escribe de nuevo:", { parse_mode: "HTML" });
    }

    const cap = `⚡ <b>${BRAND_NAME}</b> ⚡\n✅ Comprobante Generado`;
    try {
      const res = await generarComprobanteBancolAhorros(ctx.session.nombre_destino, cuenta, ctx.session.valor);
      await ctx.replyWithDocument({ source: res.buffer, filename: "comprobante.png" }, { caption: cap, parse_mode: "HTML" });
    } catch (e) {
      console.error("Error al generar comprobante Bancolombia:", e);
      await ctx.reply("❌ Error al generar el comprobante. Revisa que las plantillas de imagen estén presentes en el servidor.");
    } finally {
      ctx.session = {};
    }
    return;
  }

  if (paso === "referencia") {
    ctx.session.ref_m = texto.trim();
    ctx.session.paso = "cantidad";
    return ctx.telegram.editMessageText(chatId, msgId, null, "💰 Escribe la <b>CANTIDAD</b>:", { parse_mode: "HTML" });
  }

  if (paso === "cantidad") {
    if (!validarCantidad(texto)) {
      return ctx.telegram.editMessageText(chatId, msgId, null, "❌ Cantidad mínima $500. Escribe de nuevo:", { parse_mode: "HTML" });
    }

    const nom = ctx.session.nombre;
    const cant = texto.trim();
    const cap = `⚡ <b>${BRAND_NAME}</b> ⚡\n✅ Comprobante Generado`;

    try {
      let res1, res2; // CORREGIDO AQUÍ

      if (["n_qr_llave", "n_llave_persona"].includes(varType)) {
        res1 = await generarComprobante(nom, null, cant, PLANTILLA_LLAVE1, null, ctx.session.llave, ctx.session.banco, ctx.session.origen);
        res2 = await generarComprobante(nom, null, cant, PLANTILLA_LLAVE2, res1.referencia, ctx.session.llave, ctx.session.banco, ctx.session.origen);
      } else if (varType === "n_qr_empresa") {
        res1 = await generarComprobante(nom, "3000000000", cant, PLANTILLA_QR1, ctx.session.ref_m);
        res2 = await generarComprobante(nom, "3000000000", cant, PLANTILLA_QR2, ctx.session.ref_m);
      } else if (varType === "n_bancol") {
        res1 = await generarComprobante(nom, ctx.session.numero, cant, PLANTILLA_BANCO1);
        res2 = await generarComprobante(nom, ctx.session.numero, cant, PLANTILLA_BANCO2, res1.referencia);
      } else {
        res1 = await generarComprobante(nom, ctx.session.numero, cant, PLANTILLA);
        res2 = await generarComprobante(nom, ctx.session.numero, cant, PLANTILLA2, res1.referencia);
      }

      await ctx.replyWithDocument({ source: res1.buffer, filename: "comprobante1.png" }, { caption: `${cap} (1/2)`, parse_mode: "HTML" });
      await ctx.replyWithDocument({ source: res2.buffer, filename: "comprobante2.png" }, { caption: `${cap} (2/2)`, parse_mode: "HTML" });
    } catch (e) {
      console.error("Error al generar comprobantes de Nequi:", e);
      await ctx.reply("❌ Ocurrió un error al generar las imágenes. Verifica que todas las plantillas PNG estén subidas correctamente en GitHub.");
    } finally {
      ctx.session = {};
    }
  }
});

// ---------- SERVIDOR EXPRESS Y DESPLIEGUE ----------
const app = express();
app.get('/', (req, res) => res.send('Bot activo en Render'));

app.listen(PORT, () => {
  console.log(`Servidor Web activo en el puerto ${PORT}`);
  bot.launch().then(() => {
    console.log("Bot iniciado con éxito en Render...");
  });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
