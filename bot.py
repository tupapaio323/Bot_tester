import tempfile
import asyncio
import re
import os
import json
import datetime
import random
import logging
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageEnhance, ImageOps, ImageDraw, ImageFont
from pyzbar.pyzbar import decode

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ChatMember
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters
)
from telegram.request import HTTPXRequest
from telegram.error import BadRequest

# ================== CONFIG ==================

TOKEN = os.getenv("TOKEN", "8081387434:AAEgQsJRzhF36yxjREuOaWhUv8bglYdYE50")
CANAL_ID = -1003526399267
CANAL_LINK = "https://t.me/+6fR_ZofaYwhkOWUx"

# Rutas de Plantillas (Ubicadas en la raíz del repositorio, como en index.js)
PLANTILLA = "./base1.png"
PLANTILLA2 = "./base2.png"
PLANTILLA_QR1 = "./qr1.png"
PLANTILLA_QR2 = "./qr2.png"
PLANTILLA_LLAVE1 = "./llave1.png"
PLANTILLA_LLAVE2 = "./llave2.png"
PLANTILLA_BANCO1 = "./banco1.png"
PLANTILLA_BANCO2 = "./banco2.png"
PLANTILLA_BANCOL_AHORROS = "./bancolombia1.png"

# Fuentes para BANCOLOMBIA BANCOL AHORROS (Ubicadas en la raíz del repositorio)
FUENTE_BANCOL = "./bancolombia.ttf"
FUENTE_BANCOL_SANS = "./bancolombia_sans.ttf"

FUENTE = "./Manrope_Regular.ttf"
COLOR_TEXTO = "#230620"
RUTA_USUARIOS = "./usuarios_bot.json"
BRAND_NAME = "𝓖𝓲𝓯𝓽 𝓟𝓸𝔀𝓮𝓻𝓮𝓭"

# ============================================

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
request_provider = HTTPXRequest(read_timeout=60)

# ---------- VALIDACIONES ----------
def validar_nombre(n): return len(n.strip()) > 2
def validar_numero_nequi(n): return n.isdigit() and len(n) == 10 and n.startswith("3")
def validar_cantidad(c): return c.isdigit() and int(c) >= 500

# ---------- GESTIÓN DE USUARIOS ----------
def guardar_usuario(user_id, nombre):
    usuarios = {}
    if os.path.exists(RUTA_USUARIOS):
        try:
            with open(RUTA_USUARIOS, 'r') as f:
                contenido = f.read().strip()
                if contenido: usuarios = json.loads(contenido)
        except: usuarios = {}
    
    if not isinstance(usuarios, dict): usuarios = {}
    uid_str = str(user_id)
    if uid_str not in usuarios:
        usuarios[uid_str] = {"nombre": nombre}
        try:
            with open(RUTA_USUARIOS, 'w') as f: json.dump(usuarios, f, indent=4)
        except: pass

# ---------- LÓGICA ESCANEO QR ----------
def extraer_nombre(texto):
    match = re.search(r"59(\d{2})(.+)", texto)
    if match:
        longitud = int(match.group(1))
        posible_nombre = match.group(2)[:longitud].strip()
        if posible_nombre: return posible_nombre
    match = re.search(r"([A-ZÁÉÍÓÚÑ0-9_]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9_]{2,}){1,3})", texto)
    if match:
        nombre_compuesto = match.group(1).strip()
        if not nombre_compuesto.replace(" ", "").isdigit(): return nombre_compuesto
    return None

def extraer_telefono(texto):
    match = re.search(r"(\d{10})0703", texto)
    return match.group(1) if match else None

def extraer_llave(texto: str):
    m = re.search(r"CO\.COM\.RBM\.IVA503(\d{13,})", texto)
    if m:
        bloque = m.group(1)
        idx = bloque.find('010', 0, 6)
        if idx != -1 and len(bloque) >= idx + 3 + 10: return '00' + bloque[idx + 3: idx + 13]
        if len(bloque) >= 15: return bloque[5:15]
    m2 = re.search(r"\b010(\d{10})\b", texto)
    if m2: return '00' + m2.group(1)
    return None

def leer_qr_sync(path: str):
    img_src = Image.open(path)
    img_gray = img_src.convert("L")
    max_side = 2200
    if max(img_gray.size) > max_side:
        scale = max_side / float(max(img_gray.size))
        img_gray = img_gray.resize((int(img_gray.width * scale), int(img_gray.height * scale)))
    
    seen = set()
    for s in [1.0, 1.5]:
        base = img_gray if s == 1.0 else img_gray.resize((int(img_gray.width * s), int(img_gray.height * s)))
        for thr in [None, 160, 200]:
            variant = base if thr is None else base.point(lambda p: 255 if p > thr else 0).convert("L")
            for ang in [0, 90, 180, 270]:
                candidate = variant.rotate(ang, expand=True)
                decoded = decode(candidate)
                if decoded:
                    for d in decoded:
                        try: payload = d.data.decode("utf-8")
                        except: payload = d.data.decode(errors="ignore")
                        seen.add(payload)
                    return list(seen)
    return list(seen)

# ---------- FUNCIONES COMPROBANTES ----------
def formatear_cantidad(valor):
    return "$ {:,.2f}".format(int(valor)).replace(",", "X").replace(".", ",").replace("X", ".")

def formatear_numero(numero):
    if not numero: return ""
    return f"{numero[:3]} {numero[3:6]} {numero[6:]}"

BASE_IMG = Image.open(PLANTILLA).convert("RGB")
BASE_IMG_2 = Image.open(PLANTILLA2).convert("RGB")
QR_IMG_1 = Image.open(PLANTILLA_QR1).convert("RGB")
QR_IMG_2 = Image.open(PLANTILLA_QR2).convert("RGB")
LLAVE_IMG_1 = Image.open(PLANTILLA_LLAVE1).convert("RGB")
LLAVE_IMG_2 = Image.open(PLANTILLA_LLAVE2).convert("RGB")
BANCO_IMG_1 = Image.open(PLANTILLA_BANCO1).convert("RGB")
BANCO_IMG_2 = Image.open(PLANTILLA_BANCO2).convert("RGB")
BANCOL_AHORROS_IMG = Image.open(PLANTILLA_BANCOL_AHORROS).convert("RGB")
FONT = ImageFont.truetype(FUENTE, 62)
FONT_BANCOL = ImageFont.truetype(FUENTE_BANCOL, 62)
FONT_BANCOL_SANS = ImageFont.truetype(FUENTE_BANCOL_SANS, 62)

def generar_comprobante(nombre, numero, cantidad, plantilla=None, referencia=None, llave=None, banco=None, origen=None):
    img = (plantilla or BASE_IMG).copy()
    draw = ImageDraw.Draw(img)
    if referencia is None: referencia = "M1" + "".join(str(random.randint(0, 9)) for _ in range(7))
    ahora = datetime.datetime.now()
    
    if plantilla in (BANCO_IMG_1, BANCO_IMG_2):
        meses_abr = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        periodo = "A. M." if ahora.hour < 12 else "P. M."
        h12 = ahora.hour % 12 or 12
        fec = f"{ahora.day:02d} De {meses_abr[ahora.month-1]} De {ahora.year}, {h12:02d}:{ahora.minute:02d} {periodo}"
    else:
        meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        fec = f"{ahora.day:02d} de {meses[ahora.month-1]} de {ahora.year} a las {ahora.hour % 12 or 12:02d}:{ahora.minute:02d} {'a. m.' if ahora.hour < 12 else 'p. m.'}"

    cant_f = formatear_cantidad(cantidad)
    if plantilla == BASE_IMG_2: coords = [(148, 2922), (144, 1700), (144, 1960), (144, 2187), (144, 2425), (145, 2665)]
    elif plantilla == QR_IMG_1: coords = [(215, 2555), (215, 1480), (215, 1762), None, (215, 2015), (213, 2270)]
    elif plantilla == QR_IMG_2: coords = [(144, 2682), (143, 1715), (145, 1955), None, (144, 2185), (143, 2430)]
    elif plantilla == LLAVE_IMG_1: coords = [(143, 3195), (143, 1490), (143, 2470), None, (143, 2213), (143, 2697)]
    elif plantilla == LLAVE_IMG_2: coords = [(143, 3410), (143, 1697), (143, 2680), None, (143, 2428), (143, 2915)]
    elif plantilla == BANCO_IMG_1: coords = [(143, 2967), (143, 1505), (143, 1760), None, (143, 1995), (143, 2715)]
    elif plantilla == BANCO_IMG_2: coords = [(143, 3162), (143, 1700), (143, 1963), None, (143, 2195), (143, 2913)]
    else: coords = [(148, 3135), (150, 1820), (150, 2090), (148, 2340), (148, 2598), (150, 2860)]

    p_est, p_nom, p_can, p_num, p_fec, p_ref = coords
    draw.text(p_est, "Disponible", fill=COLOR_TEXTO, font=FONT)
    draw.text(p_nom, nombre, fill=COLOR_TEXTO, font=FONT)
    draw.text(p_can, cant_f, fill=COLOR_TEXTO, font=FONT)
    draw.text(p_fec, fec, fill=COLOR_TEXTO, font=FONT)
    draw.text(p_ref, referencia, fill=COLOR_TEXTO, font=FONT)
    if p_num and numero: draw.text(p_num, formatear_numero(numero), fill=COLOR_TEXTO, font=FONT)
    
    if plantilla in (LLAVE_IMG_1, LLAVE_IMG_2):
        draw.text((143, 1727 if plantilla==LLAVE_IMG_1 else 1947), str(llave), fill=COLOR_TEXTO, font=FONT)
        draw.text((143, 1980 if plantilla==LLAVE_IMG_1 else 2192), str(banco), fill=COLOR_TEXTO, font=FONT)
        draw.text((143, 2950 if plantilla==LLAVE_IMG_1 else 3170), str(origen), fill=COLOR_TEXTO, font=FONT)

    buf = BytesIO(); img.save(buf, format="JPEG", quality=90); buf.seek(0)
    return buf, referencia

def generar_comprobante_bancol_ahorros(nombre_destino, cuenta_destino, valor):
    # Usar imagen RGBA para poder manejar opacidad
    img = BANCOL_AHORROS_IMG.convert("RGBA")
    draw = ImageDraw.Draw(img)
    
    # Color blanco
    COLOR_BLANCO = (255, 255, 255, 255)
    COLOR_BLANCO_90 = (255, 255, 255, 230)  # ~90% opacity
    
    ahora = datetime.datetime.now()
    
    # Formato de fecha: "05 Ene 2026 - 06:44 p. m."
    meses_abr = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    periodo = "a. m." if ahora.hour < 12 else "p. m."
    h12 = ahora.hour % 12 or 12
    fec = f"{ahora.day:02d} {meses_abr[ahora.month-1]} {ahora.year} - {h12:02d}:{ahora.minute:02d} {periodo}"
    
    # Formato de referencia: "Comprobante No. 00000(2 digitos aleatorios)00"
    random_digitos = "".join(str(random.randint(0, 9)) for _ in range(2))
    referencia = f"Comprobante No. 00000{random_digitos}00"
    
    # Formatear valor como "$ 0,00" donde 00 es mas pequeno
    valor_formateado = formatear_cantidad(valor)  # $ X.XXX,XX
    
    # Dibujar el valor con formato especial: $ 0,00 donde 00 es mas pequeno
    # Posiciones - estas coordenadas deben ajustarse segun la plantilla
    # Valor de la transferencia - usa FUENTE_BANCOL (blanco completo)
    pos_valor = (200, 800)  # Ajustar segun plantilla
    draw.text(pos_valor, valor_formateado, fill=COLOR_BLANCO, font=FONT_BANCOL)
    
    # Nombre destino - usa FUENTE_BANCOL_SANS (blanco completo)
    pos_nombre = (200, 1000)  # Ajustar segun plantilla
    draw.text(pos_nombre, nombre_destino, fill=COLOR_BLANCO, font=FONT_BANCOL_SANS)
    
    # Cuenta destino - usa FUENTE_BANCOL_SANS (blanco completo)
    pos_cuenta = (200, 1200)  # Ajustar segun plantilla
    draw.text(pos_cuenta, cuenta_destino, fill=COLOR_BLANCO, font=FONT_BANCOL_SANS)
    
    # Fecha con 90% opacidad SOLO - usa FUENTE_BANCOL_SANS
    pos_fecha = (200, 1400)  # Ajustar segun plantilla
    draw.text(pos_fecha, fec, fill=COLOR_BLANCO_90, font=FONT_BANCOL_SANS)
    
    # Referencia con 90% opacidad SOLO - usa FUENTE_BANCOL_SANS
    pos_ref = (200, 1600)  # Ajustar segun plantilla
    draw.text(pos_ref, referencia, fill=COLOR_BLANCO_90, font=FONT_BANCOL_SANS)
    
    # Convertir de vuelta a RGB para guardar como JPEG
    img_rgb = img.convert("RGB")
    
    buf = BytesIO(); img_rgb.save(buf, format="JPEG", quality=90); buf.seek(0)
    return buf, referencia

# ---------- MENÚS ----------
def menu_principal(nombre):
    nombre_esc = nombre.replace("<", "&lt;").replace(">", "&gt;")
    texto = f"✨ <b>𝗛𝗢𝗟𝗔 {nombre_esc}</b>\n\n🚀 ¿𝗤𝗨𝗘 𝗤𝗨𝗜𝗘𝗥𝗘𝗦 𝗛𝗔𝗖𝗘𝗥 𝗛𝗢𝗬?"
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🧾 GENERAR COMPROBANTE", callback_data="generar")],
        [InlineKeyboardButton("🔍 ESCANEAR QR", callback_data="scan_qr")],
        [InlineKeyboardButton("📢 CANAL", callback_data="delay_canal")],
        [InlineKeyboardButton("❓ AYUDA", callback_data="delay_ayuda")]
    ])
    return texto, kb

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    guardar_usuario(user.id, user.full_name)
    if not await verificar_canal(context, user.id):
        texto = f"<b>🚫 ACCESO BLOQUEADO</b>\n\n🔒 Debes unirte al canal oficial para usar el bot."
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("📢 UNIRME", url=CANAL_LINK)],[InlineKeyboardButton("✅ YA ME UNÍ", callback_data="verificar_canal")]])
        await update.message.reply_text(texto, reply_markup=kb, parse_mode="HTML"); return
        t, m = menu_principal(f"@{user.username}" if user.username else user.first_name)
        await update.message.reply_text(t, reply_markup=m, parse_mode="HTML")

async def verificar_canal(context, user_id: int):
    try:
        member = await context.bot.get_chat_member(CANAL_ID, user_id)
        return member.status in ("member", "administrator", "creator")
    except: return False

async def botones(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query; await query.answer(); d = query.data
    if d == "generar":
        kb = [
            [InlineKeyboardButton("🟣 NEQUI", callback_data="nequi")],
            [InlineKeyboardButton("🟡 BANCOLOMBIA", callback_data="bancol")],
            [InlineKeyboardButton("🔙 VOLVER", callback_data="back")]
        ]
        await query.edit_message_text("🧾 <b>GENERAR COMPROBANTE</b>\n\nSelecciona plataforma:", reply_markup=InlineKeyboardMarkup(kb), parse_mode="HTML")
    elif d == "nequi":
        kb = [
            [InlineKeyboardButton("🟣 NEQUI A NEQUI", callback_data="n_n")],
            [InlineKeyboardButton("🟣 NEQUI A BANCOL", callback_data="n_bancol")],
            [InlineKeyboardButton("🟣 NEQUI A QR EMPRESA", callback_data="n_qr_empresa")],
            [InlineKeyboardButton("🟣 NEQUI A QR LLAVE", callback_data="n_qr_llave")],
            [InlineKeyboardButton("🟣 NEQUI A LLAVE PERSONA", callback_data="n_llave_persona")],
            [InlineKeyboardButton("🔙 VOLVER", callback_data="generar")]
        ]
        await query.edit_message_text("🟣 <b>OPCIONES NEQUI</b>:", reply_markup=InlineKeyboardMarkup(kb), parse_mode="HTML")
    elif d == "bancol":
        kb = [
            [InlineKeyboardButton("🟡 BANCOL A BANCOL", callback_data="bancol_ahorros")],
            [InlineKeyboardButton("🔙 VOLVER", callback_data="generar")]
        ]
        await query.edit_message_text("🟡 <b>OPCIONES BANCOLOMBIA</b>:", reply_markup=InlineKeyboardMarkup(kb), parse_mode="HTML")
    elif d == "scan_qr":
        context.user_data["esperando_qr"] = True
        await query.edit_message_text("📥 <b>MODO ESCÁNER</b>\n\nEnvía la foto del QR para extraer datos.", parse_mode="HTML")
    elif d == "back":
        n = f"@{query.from_user.username}" if query.from_user.username else query.from_user.first_name
        t, m = menu_principal(n); await query.edit_message_text(t, reply_markup=m, parse_mode="HTML")
    elif d in ("n_n", "n_bancol", "n_qr_empresa", "n_qr_llave", "n_llave_persona"):
        context.user_data.update({"variante": d, "paso": "nombre", "msg_id": query.message.message_id})
        await query.edit_message_text("🟣 Escribe el <b>NOMBRE / EMPRESA</b>:", parse_mode="HTML")
    elif d == "bancol_ahorros":
        context.user_data.update({"variante": "bancol_ahorros", "paso": "valor", "msg_id": query.message.message_id})
        await query.edit_message_text("💰 Escribe el <b>VALOR DE LA TRANSFERENCIA</b>:", parse_mode="HTML")
    elif d == "delay_canal":
        await query.edit_message_text(f"📢 <b>CANAL</b>\n\nÚnete: {CANAL_LINK}", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 VOLVER", callback_data="back")]]), parse_mode="HTML")
    elif d == "verificar_canal":
        user = update.callback_query.from_user
        if await verificar_canal(context, user.id):
            await query.edit_message_text("✅ ¡Bienvenido! Ya puedes usar el bot.", parse_mode="HTML")
            t, m = menu_principal(f"@{user.username}" if user.username else user.first_name)
            await context.bot.send_message(user.id, t, reply_markup=m, parse_mode="HTML")
        else:
            await query.edit_message_text("❌ Aún no te has unido. Intenta de nuevo.", parse_mode="HTML")
    elif d == "delay_ayuda":
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("💬 CHATEAR", url="https://t.me/Shop_powered")], [InlineKeyboardButton("🔙 VOLVER", callback_data="back")]])
        await query.edit_message_text("📖 <b>AYUDA</b>\n\n¿Tienes dudas? Chatea con nosotros:", reply_markup=kb, parse_mode="HTML")

# ---------- MANEJO DE MENSAJES ----------
async def manejar_mensajes(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if context.user_data.get("esperando_qr") and (update.message.photo or update.message.document):
        archivo = await (update.message.photo[-1].get_file() if update.message.photo else update.message.document.get_file())
        msg_wait = await update.message.reply_text("🔍 Escaneando...")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        try:
            await archivo.download_to_drive(tmp.name)
            payloads = await asyncio.to_thread(leer_qr_sync, tmp.name)
            if payloads:
                resp = []
                for p in payloads:
                    tel, nom, lla = extraer_telefono(p), extraer_nombre(p), extraer_llave(p)
                    txt = f"<b>📌 DATOS QR</b>\n"
                    if lla: txt += f"🔑 Llave: <code>{lla}</code>\n"
                    elif tel: txt += f"📞 Teléfono: <code>{tel}</code>\n"
                    if nom: txt += f"📜 Titular: {nom}"
                    resp.append(txt)
                await msg_wait.edit_text(f"🔥 <b>{BRAND_NAME} SCAN</b> 🔥\n\n" + "\n\n".join(resp), parse_mode="HTML")
            else: await msg_wait.edit_text("⚠️ No se detectó QR.")
        except Exception as e:
            print("Error al procesar el QR:", e)
            await msg_wait.edit_text("⚠️ Error al procesar el QR.")
        finally:
            tmp.close(); os.unlink(tmp.name); context.user_data["esperando_qr"] = False
        return

    if "paso" not in context.user_data: return
    paso, var = context.user_data["paso"], context.user_data["variante"]
    texto, chat_id, msg_id = update.message.text, update.message.chat_id, context.user_data["msg_id"]
    await context.bot.delete_message(chat_id, update.message.message_id)

    if paso == "nombre":
        if not validar_nombre(texto):
            await context.bot.edit_message_text("❌ Nombre muy corto. Escribe de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        context.user_data["nombre"] = texto.strip().title()
        if var in ("n_qr_llave", "n_llave_persona"): 
            context.user_data["paso"] = "llave"
            await context.bot.edit_message_text("🔑 Escribe la <b>LLAVE</b>:", chat_id, msg_id, parse_mode="HTML")
        elif var == "n_qr_empresa":
            context.user_data["paso"] = "referencia"
            await context.bot.edit_message_text("📝 Escribe la <b>REFERENCIA</b>:", chat_id, msg_id, parse_mode="HTML")
        else:
            context.user_data["paso"] = "numero"
            await context.bot.edit_message_text("📲 Escribe el <b>NÚMERO</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "llave":
        context.user_data["llave"] = texto.strip()
        context.user_data["paso"] = "banco"
        await context.bot.edit_message_text("🏦 Escribe el <b>BANCO DESTINO</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "banco":
        context.user_data["banco"] = texto.strip()
        context.user_data["paso"] = "origen"
        await context.bot.edit_message_text("📍 ¿De dónde se hizo el envío? (Ej: Nequi):", chat_id, msg_id, parse_mode="HTML")

    elif paso == "origen":
        context.user_data["origen"] = texto.strip()
        context.user_data["paso"] = "cantidad"
        await context.bot.edit_message_text("💰 Escribe la <b>CANTIDAD</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "numero":
        if not (validar_numero_nequi(texto) or var == "n_bancol"):
            await context.bot.edit_message_text("❌ Número inválido. Intenta de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        context.user_data["numero"] = texto.strip(); context.user_data["paso"] = "cantidad"
        await context.bot.edit_message_text("💰 Escribe la <b>CANTIDAD</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "valor":
        if not validar_cantidad(texto):
            await context.bot.edit_message_text("❌ Valor mínimo $500. Escribe de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        context.user_data["valor"] = texto.strip()
        context.user_data["paso"] = "nombre_destino"
        await context.bot.edit_message_text("👤 Escribe el <b>NOMBRE DESTINO</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "nombre_destino":
        if not validar_nombre(texto):
            await context.bot.edit_message_text("❌ Nombre muy corto. Escribe de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        context.user_data["nombre_destino"] = texto.strip().title()
        context.user_data["paso"] = "cuenta"
        await context.bot.edit_message_text("🏦 Escribe la <b>CUENTA DESTINO</b> (11 dígitos):", chat_id, msg_id, parse_mode="HTML")

    elif paso == "cuenta":
        cuenta = texto.strip()
        if not (cuenta.isdigit() and len(cuenta) == 11):
            await context.bot.edit_message_text("❌ La cuenta debe tener exactamente 11 dígitos. Escribe de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        context.user_data["cuenta"] = cuenta
        
        # Generar comprobante para bancol_ahorros
        valor = context.user_data["valor"]
        nombre_destino = context.user_data["nombre_destino"]
        cuenta_destino = cuenta
        
        cap = f"⚡ <b>{BRAND_NAME}</b> ⚡\n✅ Comprobante Generado"
        i1, r = generar_comprobante_bancol_ahorros(nombre_destino, cuenta_destino, valor)
        
        await context.bot.send_document(chat_id, i1, filename="comprobante.png", caption=cap, parse_mode="HTML")
        context.user_data.clear()

    elif paso == "referencia":
        context.user_data["ref_m"] = texto.strip(); context.user_data["paso"] = "cantidad"
        await context.bot.edit_message_text("💰 Escribe la <b>CANTIDAD</b>:", chat_id, msg_id, parse_mode="HTML")

    elif paso == "cantidad":
        if not validar_cantidad(texto):
            await context.bot.edit_message_text("❌ Cantidad mínima $500. Escribe de nuevo:", chat_id, msg_id, parse_mode="HTML"); return
        
        nom, cant = context.user_data["nombre"], texto.strip()
        cap = f"⚡ <b>{BRAND_NAME}</b> ⚡\n✅ Comprobante Generado"
        
        if var in ("n_qr_llave", "n_llave_persona"):
            i1, r = generar_comprobante(nom, None, cant, LLAVE_IMG_1, None, context.user_data["llave"], context.user_data["banco"], context.user_data["origen"])
            i2, _ = generar_comprobante(nom, None, cant, LLAVE_IMG_2, r, context.user_data["llave"], context.user_data["banco"], context.user_data["origen"])
        elif var == "n_qr_empresa":
            i1, _ = generar_comprobante(nom, "3000000000", cant, QR_IMG_1, context.user_data["ref_m"])
            i2, _ = generar_comprobante(nom, "3000000000", cant, QR_IMG_2, context.user_data["ref_m"])
        elif var == "n_bancol":
            i1, r = generar_comprobante(nom, context.user_data["numero"], cant, BANCO_IMG_1)
            i2, _ = generar_comprobante(nom, context.user_data["numero"], cant, BANCO_IMG_2, r)
        else:
            i1, r = generar_comprobante(nom, context.user_data["numero"], cant, BASE_IMG)
            i2, _ = generar_comprobante(nom, context.user_data["numero"], cant, BASE_IMG_2, r)

        # ARREGLO PARA QUE SE VEAN COMO IMÁGENES
        await context.bot.send_document(chat_id, i1, filename="comprobante1.png", caption=f"{cap} (1/2)", parse_mode="HTML")
        await context.bot.send_document(chat_id, i2, filename="comprobante2.png", caption=f"{cap} (2/2)", parse_mode="HTML")
        context.user_data.clear()

def main():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(botones))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE | filters.TEXT, manejar_mensajes))
    print("Bot Restaurado con Todas las Opciones...")
    app.run_polling()

if __name__ == "__main__": main()
