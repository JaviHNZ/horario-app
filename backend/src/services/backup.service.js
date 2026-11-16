/**
 * Servicio de copias de seguridad y exportaciones de Claudia Neteja.
 *
 * - Excel de clientes/casas, trabajadores y servicios (ExcelJS).
 * - Copia SQL real con `mysqldump` (estructura + datos, sin secretos).
 * - ZIP completo con los Excel, el SQL y un README.
 * - Verificación de los archivos generados (se reabren y se comprueban).
 * - Historial en `backups/index.json` (no toca la base de datos).
 * - Programador de copias automáticas dentro del proceso del backend.
 * - Integración real con Google Drive mediante OAuth 2.0 y la API REST.
 *
 * Reglas de horas: la duración del servicio se calcula siempre con
 * `hora_inicio`/`hora_fin`; las horas individuales suman esa duración por
 * cada trabajador asignado. `duracion_minutos` de la casa es solo referencia.
 */
require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ExcelJS = require("exceljs");
const archiver = require("archiver");
const JSZip = require("jszip");
const mysql = require("mysql2/promise");

const db = require("../config/db");

const BACKEND_DIR = path.resolve(__dirname, "../..");
const BACKUP_DIR = path.join(BACKEND_DIR, "backups");
const INDEX_FILE = path.join(BACKUP_DIR, "index.json");
const CONFIG_FILE = path.join(BACKUP_DIR, "config.json");
const DRIVE_TOKENS_FILE = path.join(BACKUP_DIR, "google-drive-tokens.json");
const TEMP_DIR = path.join(BACKUP_DIR, "tmp");

const APP_VERSION = (() => {
  try {
    return require("../../package.json").version || "1.0.0";
  } catch {
    return "1.0.0";
  }
})();

const NOMBRE_APP = "Claudia Neteja";
const TABLAS_RESPALDO = [
  "casas",
  "trabajadores",
  "dias",
  "horarios",
  "horario_trabajadores",
  "facturas",
  "factura_detalles",
];

// ============================================
// UTILIDADES
// ============================================

async function asegurarDirectorios() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

function fechaParaNombre(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, "0");

  return (
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
    `_${dos(fecha.getHours())}-${dos(fecha.getMinutes())}-${dos(fecha.getSeconds())}`
  );
}

function calcularMinutos(inicio, fin) {
  if (!inicio || !fin) {
    return 0;
  }

  const [h1, m1] = String(inicio).slice(0, 5).split(":").map(Number);
  const [h2, m2] = String(fin).slice(0, 5).split(":").map(Number);

  let minutos = h2 * 60 + m2 - (h1 * 60 + m1);

  if (minutos < 0) {
    minutos += 1440;
  }

  return Math.max(0, minutos);
}

function minutosAHoras(minutos) {
  return Math.round((Number(minutos) / 60) * 100) / 100;
}

function nombreCompletoTrabajador(trabajador) {
  return [trabajador.nombre, trabajador.apellidos]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function letraColumna(numero) {
  let letra = "";
  let n = numero;

  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }

  return letra;
}

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }

  return String(valor);
}

async function escribirJsonAtomico(ruta, contenido) {
  const temporal = `${ruta}.tmp`;
  await fs.writeFile(temporal, JSON.stringify(contenido, null, 2), "utf8");
  await fs.rename(temporal, ruta);
}

// ============================================
// SNAPSHOT CONSISTENTE
// ============================================

async function obtenerSnapshot() {
  const connection = await db.getConnection();

  try {
    // Una sola foto lógica para todos los Excel.
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const [casas] = await connection.query(
      `SELECT * FROM casas ORDER BY nombre ASC, id ASC`,
    );
    const [trabajadores] = await connection.query(
      `SELECT * FROM trabajadores ORDER BY codigo ASC, id ASC`,
    );
    const [servicios] = await connection.query(
      `
      SELECT
        h.id,
        h.dia_id,
        d.fecha,
        d.estado AS dia_estado,
        h.casa_id,
        c.nombre AS casa,
        h.hora_inicio,
        h.hora_fin,
        h.observaciones,
        h.duracion_facturable_minutos
      FROM horarios h
      INNER JOIN dias d ON d.id = h.dia_id
      INNER JOIN casas c ON c.id = h.casa_id
      ORDER BY d.fecha ASC, h.hora_inicio ASC, h.id ASC
      `,
    );
    const [asignaciones] = await connection.query(
      `
      SELECT
        ht.horario_id,
        t.id,
        t.nombre,
        t.apellidos,
        t.codigo
      FROM horario_trabajadores ht
      INNER JOIN trabajadores t ON t.id = ht.trabajador_id
      ORDER BY t.codigo ASC
      `,
    );

    await connection.commit();

    const trabajadoresPorHorario = new Map();

    for (const asignacion of asignaciones) {
      if (!trabajadoresPorHorario.has(asignacion.horario_id)) {
        trabajadoresPorHorario.set(asignacion.horario_id, []);
      }

      trabajadoresPorHorario.get(asignacion.horario_id).push({
        id: asignacion.id,
        nombre: asignacion.nombre,
        apellidos: asignacion.apellidos,
        codigo: asignacion.codigo,
      });
    }

    const serviciosConDatos = servicios.map((servicio) => ({
      ...servicio,
      minutos: calcularMinutos(servicio.hora_inicio, servicio.hora_fin),
      trabajadores: trabajadoresPorHorario.get(servicio.id) || [],
    }));

    const totalMinutosServicio = serviciosConDatos.reduce(
      (total, servicio) => total + servicio.minutos,
      0,
    );

    const totalMinutosIndividuales = serviciosConDatos.reduce(
      (total, servicio) =>
        total + servicio.minutos * servicio.trabajadores.length,
      0,
    );

    return {
      generadoEn: new Date(),
      casas,
      trabajadores,
      servicios: serviciosConDatos,
      totalMinutosServicio,
      totalMinutosIndividuales,
      totalAsignaciones: asignaciones.length,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function agruparMensual(snapshot) {
  const mapa = new Map();

  for (const servicio of snapshot.servicios) {
    const mes = String(servicio.fecha).slice(0, 7);
    const clave = `${servicio.casa_id}|${mes}`;

    if (!mapa.has(clave)) {
      mapa.set(clave, {
        casa_id: servicio.casa_id,
        casa: servicio.casa,
        mes,
        servicios: 0,
        minutos: 0,
        trabajadores: new Set(),
      });
    }

    const grupo = mapa.get(clave);
    grupo.servicios += 1;
    grupo.minutos += servicio.minutos;

    for (const trabajador of servicio.trabajadores) {
      grupo.trabajadores.add(trabajador.codigo);
    }
  }

  return [...mapa.values()]
    .map((grupo) => ({
      ...grupo,
      trabajadores: [...grupo.trabajadores].sort().join(", "),
    }))
    .sort((a, b) =>
      a.casa.localeCompare(b.casa) || a.mes.localeCompare(b.mes),
    );
}

// ============================================
// EXCEL: HELPERS
// ============================================

function crearHoja(workbook, nombre, columnas) {
  const hoja = workbook.addWorksheet(nombre, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  hoja.columns = columnas.map((columna) => ({
    header: columna.header,
    key: columna.key,
    width: columna.width || 18,
  }));

  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true };
  cabecera.alignment = { vertical: "middle" };
  cabecera.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  hoja.autoFilter = {
    from: "A1",
    to: `${letraColumna(columnas.length)}1`,
  };

  return hoja;
}

async function escribirWorkbook(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================
// EXCEL: CLIENTES Y CASAS
// ============================================

const COLUMNAS_CLIENTES = [
  { header: "ID", key: "id", width: 8 },
  { header: "Nombre", key: "nombre", width: 28 },
  { header: "Nombre del cliente", key: "nombre_cliente", width: 24 },
  { header: "Apellidos del cliente", key: "apellidos_cliente", width: 24 },
  { header: "Teléfono / contacto", key: "contacto", width: 18 },
  { header: "Dirección", key: "direccion", width: 32 },
  { header: "Código postal", key: "codigo_postal", width: 12 },
  { header: "Población", key: "poblacion", width: 20 },
  { header: "Tipo de servicio", key: "tipo", width: 16 },
  { header: "Frecuencia", key: "frecuencia_texto", width: 18 },
  { header: "Visitas por periodo", key: "visitas_por_periodo", width: 14 },
  { header: "Periodo (días)", key: "periodo_dias", width: 12 },
  { header: "Precio por hora (€)", key: "precio_hora", width: 14 },
  { header: "Duración habitual (min)", key: "duracion_minutos", width: 16 },
  { header: "Emite factura", key: "emite_factura", width: 12 },
  { header: "Observaciones", key: "observaciones", width: 40 },
  { header: "Datos pendientes", key: "datos_pendientes", width: 14 },
  { header: "Estado", key: "estado", width: 12 },
  { header: "Fecha de alta", key: "fecha_creacion", width: 20 },
  { header: "Última actualización", key: "fecha_actualizacion", width: 20 },
  { header: "Total visitas", key: "total_visitas", width: 12 },
  { header: "Total horas reales", key: "total_horas", width: 16 },
];

const COLUMNAS_ACTIVIDAD = [
  { header: "ID casa", key: "casa_id", width: 9 },
  { header: "Casa", key: "casa", width: 28 },
  { header: "Fecha", key: "fecha", width: 12 },
  { header: "Trabajadores", key: "trabajadores", width: 36 },
  { header: "Duración real (min)", key: "minutos", width: 16 },
  { header: "Duración real (h)", key: "horas", width: 14 },
  { header: "Total visitas", key: "total_visitas", width: 12 },
  { header: "Total horas acumuladas", key: "total_horas", width: 18 },
];

const COLUMNAS_RESUMEN_CASAS = [
  { header: "Casa", key: "casa", width: 28 },
  { header: "Mes", key: "mes", width: 10 },
  { header: "Número de servicios", key: "servicios", width: 16 },
  { header: "Total horas reales", key: "horas", width: 16 },
  { header: "Trabajadores", key: "trabajadores", width: 40 },
];

async function crearExcelClientesCasas(snapshot = null) {
  const datos = snapshot || (await obtenerSnapshot());
  const workbook = new ExcelJS.Workbook();
  workbook.creator = NOMBRE_APP;
  workbook.created = new Date();

  const totalesPorCasa = new Map();

  for (const servicio of datos.servicios) {
    const actual = totalesPorCasa.get(servicio.casa_id) || {
      visitas: 0,
      minutos: 0,
    };
    actual.visitas += 1;
    actual.minutos += servicio.minutos;
    totalesPorCasa.set(servicio.casa_id, actual);
  }

  // Hoja 1: clientes y casas
  const hojaClientes = crearHoja(
    workbook,
    "Clientes y casas",
    COLUMNAS_CLIENTES,
  );

  for (const casa of datos.casas) {
    const totales = totalesPorCasa.get(casa.id) || { visitas: 0, minutos: 0 };

    hojaClientes.addRow({
      id: casa.id,
      nombre: normalizarTexto(casa.nombre),
      nombre_cliente: normalizarTexto(casa.nombre_cliente),
      apellidos_cliente: normalizarTexto(casa.apellidos_cliente),
      contacto: normalizarTexto(casa.contacto),
      direccion: normalizarTexto(casa.direccion),
      codigo_postal: normalizarTexto(casa.codigo_postal),
      poblacion: normalizarTexto(casa.poblacion),
      tipo: normalizarTexto(casa.tipo),
      frecuencia_texto: normalizarTexto(casa.frecuencia_texto),
      visitas_por_periodo: casa.visitas_por_periodo ?? "",
      periodo_dias: casa.periodo_dias ?? "",
      precio_hora: casa.precio_hora ?? "",
      duracion_minutos: casa.duracion_minutos ?? "",
      emite_factura: Number(casa.emite_factura) ? "Sí" : "No",
      observaciones: normalizarTexto(casa.observaciones),
      datos_pendientes: Number(casa.datos_pendientes) ? "Sí" : "No",
      estado: Number(casa.activo) ? "Activo" : "Inactivo",
      fecha_creacion: normalizarTexto(casa.fecha_creacion),
      fecha_actualizacion: normalizarTexto(casa.fecha_actualizacion),
      total_visitas: totales.visitas,
      total_horas: minutosAHoras(totales.minutos),
    });
  }

  // Hoja 2: actividad
  const hojaActividad = crearHoja(
    workbook,
    "Actividad de las casas",
    COLUMNAS_ACTIVIDAD,
  );

  for (const servicio of datos.servicios) {
    const totales = totalesPorCasa.get(servicio.casa_id) || {
      visitas: 0,
      minutos: 0,
    };

    hojaActividad.addRow({
      casa_id: servicio.casa_id,
      casa: servicio.casa,
      fecha: servicio.fecha,
      trabajadores: servicio.trabajadores
        .map((trabajador) => trabajador.codigo)
        .join(", "),
      minutos: servicio.minutos,
      horas: minutosAHoras(servicio.minutos),
      total_visitas: totales.visitas,
      total_horas: minutosAHoras(totales.minutos),
    });
  }

  // Hoja 3: resumen mensual
  const hojaResumen = crearHoja(
    workbook,
    "Resumen mensual",
    COLUMNAS_RESUMEN_CASAS,
  );

  const resumen = agruparMensual(datos);

  for (const grupo of resumen) {
    hojaResumen.addRow({
      casa: grupo.casa,
      mes: grupo.mes,
      servicios: grupo.servicios,
      horas: minutosAHoras(grupo.minutos),
      trabajadores: grupo.trabajadores,
    });
  }

  const buffer = await escribirWorkbook(workbook);
  const verificacion = await verificarExcelClientes(buffer, datos);

  return {
    nombre: "clientes_casas.xlsx",
    buffer,
    verificacion,
    resumen: {
      casas: datos.casas.length,
      servicios: datos.servicios.length,
      filas_resumen: resumen.length,
    },
  };
}

// ============================================
// EXCEL: TRABAJADORES
// ============================================

const COLUMNAS_TRABAJADORES = [
  { header: "ID", key: "id", width: 8 },
  { header: "Nombre", key: "nombre", width: 20 },
  { header: "Apellidos", key: "apellidos", width: 24 },
  { header: "Nombre completo", key: "nombre_completo", width: 30 },
  { header: "Código", key: "codigo", width: 10 },
  { header: "Teléfono / contacto", key: "contacto", width: 18 },
  { header: "Dirección", key: "direccion", width: 32 },
  { header: "Población", key: "poblacion", width: 20 },
  { header: "Estado", key: "estado", width: 12 },
  { header: "Datos pendientes", key: "datos_pendientes", width: 14 },
  { header: "Fecha de alta", key: "fecha_creacion", width: 20 },
  { header: "Última actualización", key: "fecha_actualizacion", width: 20 },
];

const COLUMNAS_HISTORIAL_TRABAJADOR = [
  { header: "ID trabajador", key: "trabajador_id", width: 12 },
  { header: "Trabajador", key: "trabajador", width: 28 },
  { header: "Fecha", key: "fecha", width: 12 },
  { header: "Casa", key: "casa", width: 28 },
  { header: "Hora de inicio", key: "hora_inicio", width: 12 },
  { header: "Hora de finalización", key: "hora_fin", width: 16 },
  { header: "Duración real (min)", key: "minutos", width: 16 },
  { header: "Duración real (h)", key: "horas", width: 14 },
  { header: "Observaciones", key: "observaciones", width: 40 },
];

const COLUMNAS_RESUMEN_TRABAJADORES = [
  { header: "ID trabajador", key: "id", width: 12 },
  { header: "Trabajador", key: "trabajador", width: 28 },
  { header: "Código", key: "codigo", width: 10 },
  { header: "Total servicios", key: "servicios", width: 14 },
  { header: "Total horas trabajadas", key: "horas", width: 18 },
  { header: "Horas por mes", key: "horas_mes", width: 44 },
  { header: "Casas en las que ha trabajado", key: "casas", width: 48 },
];

async function crearExcelTrabajadores(snapshot = null) {
  const datos = snapshot || (await obtenerSnapshot());
  const workbook = new ExcelJS.Workbook();
  workbook.creator = NOMBRE_APP;
  workbook.created = new Date();

  const hojaDatos = crearHoja(
    workbook,
    "Datos de trabajadores",
    COLUMNAS_TRABAJADORES,
  );

  for (const trabajador of datos.trabajadores) {
    hojaDatos.addRow({
      id: trabajador.id,
      nombre: normalizarTexto(trabajador.nombre),
      apellidos: normalizarTexto(trabajador.apellidos),
      nombre_completo: nombreCompletoTrabajador(trabajador),
      codigo: normalizarTexto(trabajador.codigo),
      contacto: normalizarTexto(trabajador.contacto),
      direccion: normalizarTexto(trabajador.direccion),
      poblacion: normalizarTexto(trabajador.poblacion),
      estado: Number(trabajador.activo) ? "Activo" : "Inactivo",
      datos_pendientes: Number(trabajador.datos_pendientes) ? "Sí" : "No",
      fecha_creacion: normalizarTexto(trabajador.fecha_creacion),
      fecha_actualizacion: normalizarTexto(trabajador.fecha_actualizacion),
    });
  }

  const hojaHistorial = crearHoja(
    workbook,
    "Historial de trabajo",
    COLUMNAS_HISTORIAL_TRABAJADOR,
  );

  const resumenPorTrabajador = new Map();

  for (const trabajador of datos.trabajadores) {
    resumenPorTrabajador.set(trabajador.id, {
      id: trabajador.id,
      trabajador: nombreCompletoTrabajador(trabajador),
      codigo: trabajador.codigo,
      servicios: 0,
      minutos: 0,
      meses: new Map(),
      casas: new Set(),
    });
  }

  for (const servicio of datos.servicios) {
    for (const trabajador of servicio.trabajadores) {
      hojaHistorial.addRow({
        trabajador_id: trabajador.id,
        trabajador: nombreCompletoTrabajador(trabajador),
        fecha: servicio.fecha,
        casa: servicio.casa,
        hora_inicio: String(servicio.hora_inicio).slice(0, 5),
        hora_fin: String(servicio.hora_fin).slice(0, 5),
        minutos: servicio.minutos,
        horas: minutosAHoras(servicio.minutos),
        observaciones: normalizarTexto(servicio.observaciones),
      });

      const resumen = resumenPorTrabajador.get(trabajador.id);

      if (resumen) {
        resumen.servicios += 1;
        resumen.minutos += servicio.minutos;
        resumen.casas.add(servicio.casa);

        const mes = String(servicio.fecha).slice(0, 7);
        resumen.meses.set(
          mes,
          (resumen.meses.get(mes) || 0) + servicio.minutos,
        );
      }
    }
  }

  const hojaResumen = crearHoja(
    workbook,
    "Resumen de horas",
    COLUMNAS_RESUMEN_TRABAJADORES,
  );

  for (const resumen of resumenPorTrabajador.values()) {
    hojaResumen.addRow({
      id: resumen.id,
      trabajador: resumen.trabajador,
      codigo: resumen.codigo,
      servicios: resumen.servicios,
      horas: minutosAHoras(resumen.minutos),
      horas_mes: [...resumen.meses.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, minutos]) => `${mes}: ${minutosAHoras(minutos)} h`)
        .join("; "),
      casas: [...resumen.casas].sort().join(", "),
    });
  }

  const buffer = await escribirWorkbook(workbook);
  const verificacion = await verificarExcelTrabajadores(buffer, datos);

  return {
    nombre: "trabajadores.xlsx",
    buffer,
    verificacion,
    resumen: {
      trabajadores: datos.trabajadores.length,
      asignaciones: datos.totalAsignaciones,
    },
  };
}

// ============================================
// EXCEL: SERVICIOS
// ============================================

const COLUMNAS_SERVICIOS = [
  { header: "ID servicio", key: "id", width: 12 },
  { header: "Fecha", key: "fecha", width: 12 },
  { header: "ID día", key: "dia_id", width: 9 },
  { header: "ID casa", key: "casa_id", width: 9 },
  { header: "Casa / cliente", key: "casa", width: 28 },
  { header: "Trabajadores", key: "trabajadores", width: 28 },
  { header: "Nombres de trabajadores", key: "nombres_trabajadores", width: 44 },
  { header: "Hora de inicio", key: "hora_inicio", width: 12 },
  { header: "Hora de finalización", key: "hora_fin", width: 16 },
  { header: "Duración real (min)", key: "minutos", width: 16 },
  { header: "Duración real (h)", key: "horas", width: 14 },
  { header: "Número de trabajadores", key: "num_trabajadores", width: 16 },
  { header: "Observaciones", key: "observaciones", width: 40 },
  {
    header: "Duración facturable (min)",
    key: "duracion_facturable_minutos",
    width: 18,
  },
];

const COLUMNAS_RESUMEN_MENSUAL_SERVICIOS = [
  { header: "Mes y año", key: "mes", width: 12 },
  { header: "Número de servicios", key: "servicios", width: 16 },
  { header: "Número de casas atendidas", key: "casas", width: 20 },
  { header: "Total horas de servicio", key: "horas_servicio", width: 20 },
  { header: "Total horas individuales", key: "horas_individuales", width: 22 },
];

const COLUMNAS_RESUMEN_SERVICIOS_CASA = [
  { header: "Casa", key: "casa", width: 28 },
  { header: "Número de visitas", key: "visitas", width: 16 },
  { header: "Total horas de servicio", key: "horas", width: 20 },
];

const COLUMNAS_RESUMEN_SERVICIOS_TRABAJADOR = [
  { header: "Trabajador", key: "trabajador", width: 30 },
  { header: "Código", key: "codigo", width: 10 },
  { header: "Número de servicios", key: "servicios", width: 16 },
  { header: "Total horas trabajadas", key: "horas", width: 20 },
];

async function crearExcelServicios(snapshot = null) {
  const datos = snapshot || (await obtenerSnapshot());
  const workbook = new ExcelJS.Workbook();
  workbook.creator = NOMBRE_APP;
  workbook.created = new Date();

  const hojaServicios = crearHoja(
    workbook,
    "Todos los servicios",
    COLUMNAS_SERVICIOS,
  );

  for (const servicio of datos.servicios) {
    hojaServicios.addRow({
      id: servicio.id,
      fecha: servicio.fecha,
      dia_id: servicio.dia_id,
      casa_id: servicio.casa_id,
      casa: servicio.casa,
      trabajadores: servicio.trabajadores
        .map((trabajador) => trabajador.codigo)
        .join(", "),
      nombres_trabajadores: servicio.trabajadores
        .map((trabajador) => nombreCompletoTrabajador(trabajador))
        .join(", "),
      hora_inicio: String(servicio.hora_inicio).slice(0, 5),
      hora_fin: String(servicio.hora_fin).slice(0, 5),
      minutos: servicio.minutos,
      horas: minutosAHoras(servicio.minutos),
      num_trabajadores: servicio.trabajadores.length,
      observaciones: normalizarTexto(servicio.observaciones),
      duracion_facturable_minutos:
        servicio.duracion_facturable_minutos ?? "",
    });
  }

  // Resumen mensual
  const mensual = new Map();

  for (const servicio of datos.servicios) {
    const mes = String(servicio.fecha).slice(0, 7);

    if (!mensual.has(mes)) {
      mensual.set(mes, {
        mes,
        servicios: 0,
        casas: new Set(),
        minutosServicio: 0,
        minutosIndividuales: 0,
      });
    }

    const grupo = mensual.get(mes);
    grupo.servicios += 1;
    grupo.casas.add(servicio.casa_id);
    grupo.minutosServicio += servicio.minutos;
    grupo.minutosIndividuales +=
      servicio.minutos * servicio.trabajadores.length;
  }

  const hojaMensual = crearHoja(
    workbook,
    "Resumen mensual",
    COLUMNAS_RESUMEN_MENSUAL_SERVICIOS,
  );

  for (const grupo of [...mensual.values()].sort((a, b) =>
    a.mes.localeCompare(b.mes),
  )) {
    hojaMensual.addRow({
      mes: grupo.mes,
      servicios: grupo.servicios,
      casas: grupo.casas.size,
      horas_servicio: minutosAHoras(grupo.minutosServicio),
      horas_individuales: minutosAHoras(grupo.minutosIndividuales),
    });
  }

  // Resumen por casa
  const porCasa = new Map();

  for (const servicio of datos.servicios) {
    const actual = porCasa.get(servicio.casa_id) || {
      casa: servicio.casa,
      visitas: 0,
      minutos: 0,
    };
    actual.visitas += 1;
    actual.minutos += servicio.minutos;
    porCasa.set(servicio.casa_id, actual);
  }

  const hojaPorCasa = crearHoja(
    workbook,
    "Resumen por casa",
    COLUMNAS_RESUMEN_SERVICIOS_CASA,
  );

  for (const grupo of [...porCasa.values()].sort((a, b) =>
    a.casa.localeCompare(b.casa),
  )) {
    hojaPorCasa.addRow({
      casa: grupo.casa,
      visitas: grupo.visitas,
      horas: minutosAHoras(grupo.minutos),
    });
  }

  // Resumen por trabajador
  const porTrabajador = new Map();

  for (const servicio of datos.servicios) {
    for (const trabajador of servicio.trabajadores) {
      const actual = porTrabajador.get(trabajador.id) || {
        trabajador: nombreCompletoTrabajador(trabajador),
        codigo: trabajador.codigo,
        servicios: 0,
        minutos: 0,
      };
      actual.servicios += 1;
      actual.minutos += servicio.minutos;
      porTrabajador.set(trabajador.id, actual);
    }
  }

  const hojaPorTrabajador = crearHoja(
    workbook,
    "Resumen por trabajador",
    COLUMNAS_RESUMEN_SERVICIOS_TRABAJADOR,
  );

  for (const grupo of [...porTrabajador.values()].sort((a, b) =>
    a.trabajador.localeCompare(b.trabajador),
  )) {
    hojaPorTrabajador.addRow({
      trabajador: grupo.trabajador,
      codigo: grupo.codigo,
      servicios: grupo.servicios,
      horas: minutosAHoras(grupo.minutos),
    });
  }

  const buffer = await escribirWorkbook(workbook);
  const verificacion = await verificarExcelServicios(buffer, datos);

  return {
    nombre: "servicios_historial.xlsx",
    buffer,
    verificacion,
    resumen: {
      servicios: datos.servicios.length,
      meses: mensual.size,
      casas: porCasa.size,
      trabajadores: porTrabajador.size,
    },
  };
}

// ============================================
// VERIFICACIÓN DE EXCEL
// ============================================

function crearResultadoVerificacion() {
  return { ok: true, comprobaciones: [], errores: [] };
}

function anotar(resultado, nombre, ok, detalle) {
  resultado.comprobaciones.push({ nombre, ok, detalle });

  if (!ok) {
    resultado.ok = false;
    resultado.errores.push(`${nombre}: ${detalle}`);
  }
}

function sumarColumna(hoja, indiceColumna) {
  let total = 0;

  hoja.eachRow((fila, numero) => {
    if (numero === 1) {
      return;
    }

    const valor = Number(fila.getCell(indiceColumna).value);

    if (Number.isFinite(valor)) {
      total += valor;
    }
  });

  return total;
}

function idsDeColumna(hoja, indiceColumna) {
  const ids = new Set();

  hoja.eachRow((fila, numero) => {
    if (numero === 1) {
      return;
    }

    const valor = fila.getCell(indiceColumna).value;

    if (valor !== null && valor !== undefined && valor !== "") {
      ids.add(Number(valor));
    }
  });

  return ids;
}

function mismoConjunto(a, b) {
  if (a.size !== b.size) {
    return false;
  }

  for (const valor of a) {
    if (!b.has(valor)) {
      return false;
    }
  }

  return true;
}

async function cargarWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function verificarExcelClientes(buffer, datos) {
  const resultado = crearResultadoVerificacion();
  const workbook = await cargarWorkbook(buffer);

  const nombresEsperados = [
    "Clientes y casas",
    "Actividad de las casas",
    "Resumen mensual",
  ];

  for (const nombre of nombresEsperados) {
    anotar(
      resultado,
      `Hoja "${nombre}"`,
      Boolean(workbook.getWorksheet(nombre)),
      workbook.getWorksheet(nombre) ? "existe" : "no existe",
    );
  }

  const hojaClientes = workbook.getWorksheet("Clientes y casas");
  const hojaActividad = workbook.getWorksheet("Actividad de las casas");

  if (hojaClientes) {
    const filas = Math.max(0, hojaClientes.rowCount - 1);
    anotar(
      resultado,
      "Registros de clientes y casas",
      filas === datos.casas.length,
      `${filas} filas (esperadas ${datos.casas.length})`,
    );

    const idsEsperados = new Set(datos.casas.map((casa) => Number(casa.id)));
    const idsExportados = idsDeColumna(hojaClientes, 1);
    anotar(
      resultado,
      "Identificadores de casas conservados",
      mismoConjunto(idsEsperados, idsExportados),
      `${idsExportados.size} IDs`,
    );
  }

  if (hojaActividad) {
    const filas = Math.max(0, hojaActividad.rowCount - 1);
    anotar(
      resultado,
      "Filas de actividad",
      filas === datos.servicios.length,
      `${filas} filas (esperadas ${datos.servicios.length})`,
    );

    const minutos = sumarColumna(hojaActividad, 5);
    anotar(
      resultado,
      "Minutos de servicio coinciden",
      minutos === datos.totalMinutosServicio,
      `${minutos} min (esperados ${datos.totalMinutosServicio})`,
    );
  }

  return resultado;
}

async function verificarExcelTrabajadores(buffer, datos) {
  const resultado = crearResultadoVerificacion();
  const workbook = await cargarWorkbook(buffer);

  const nombresEsperados = [
    "Datos de trabajadores",
    "Historial de trabajo",
    "Resumen de horas",
  ];

  for (const nombre of nombresEsperados) {
    anotar(
      resultado,
      `Hoja "${nombre}"`,
      Boolean(workbook.getWorksheet(nombre)),
      workbook.getWorksheet(nombre) ? "existe" : "no existe",
    );
  }

  const hojaDatos = workbook.getWorksheet("Datos de trabajadores");
  const hojaHistorial = workbook.getWorksheet("Historial de trabajo");

  if (hojaDatos) {
    const filas = Math.max(0, hojaDatos.rowCount - 1);
    anotar(
      resultado,
      "Registros de trabajadores",
      filas === datos.trabajadores.length,
      `${filas} filas (esperadas ${datos.trabajadores.length})`,
    );

    const idsEsperados = new Set(
      datos.trabajadores.map((trabajador) => Number(trabajador.id)),
    );
    const idsExportados = idsDeColumna(hojaDatos, 1);
    anotar(
      resultado,
      "Identificadores de trabajadores conservados",
      mismoConjunto(idsEsperados, idsExportados),
      `${idsExportados.size} IDs`,
    );
  }

  if (hojaHistorial) {
    const filas = Math.max(0, hojaHistorial.rowCount - 1);
    anotar(
      resultado,
      "Filas de historial de trabajo",
      filas === datos.totalAsignaciones,
      `${filas} filas (esperadas ${datos.totalAsignaciones})`,
    );

    const minutos = sumarColumna(hojaHistorial, 7);
    anotar(
      resultado,
      "Horas individuales coinciden",
      minutos === datos.totalMinutosIndividuales,
      `${minutos} min (esperados ${datos.totalMinutosIndividuales})`,
    );
  }

  return resultado;
}

async function verificarExcelServicios(buffer, datos) {
  const resultado = crearResultadoVerificacion();
  const workbook = await cargarWorkbook(buffer);

  const nombresEsperados = [
    "Todos los servicios",
    "Resumen mensual",
    "Resumen por casa",
    "Resumen por trabajador",
  ];

  for (const nombre of nombresEsperados) {
    anotar(
      resultado,
      `Hoja "${nombre}"`,
      Boolean(workbook.getWorksheet(nombre)),
      workbook.getWorksheet(nombre) ? "existe" : "no existe",
    );
  }

  const hojaServicios = workbook.getWorksheet("Todos los servicios");
  const hojaTrabajador = workbook.getWorksheet("Resumen por trabajador");

  if (hojaServicios) {
    const filas = Math.max(0, hojaServicios.rowCount - 1);
    anotar(
      resultado,
      "Filas de servicios",
      filas === datos.servicios.length,
      `${filas} filas (esperadas ${datos.servicios.length})`,
    );

    const idsEsperados = new Set(
      datos.servicios.map((servicio) => Number(servicio.id)),
    );
    const idsExportados = idsDeColumna(hojaServicios, 1);
    anotar(
      resultado,
      "Identificadores de servicios conservados",
      mismoConjunto(idsEsperados, idsExportados),
      `${idsExportados.size} IDs`,
    );

    const minutos = sumarColumna(hojaServicios, 10);
    anotar(
      resultado,
      "Duración real coincide",
      minutos === datos.totalMinutosServicio,
      `${minutos} min (esperados ${datos.totalMinutosServicio})`,
    );
  }

  if (hojaTrabajador) {
    const minutos = sumarColumna(hojaTrabajador, 4);
    anotar(
      resultado,
      "Horas individuales por trabajador coinciden",
      Math.abs(minutos - minutosAHoras(datos.totalMinutosIndividuales)) < 0.05,
      `${minutos} h (esperadas ${minutosAHoras(
        datos.totalMinutosIndividuales,
      )} h)`,
    );
  }

  return resultado;
}

// ============================================
// SQL
// ============================================

function ejecutarMysqldump(destino) {
  return new Promise((resolve, reject) => {
    const argumentos = [
      `--host=${process.env.DB_HOST}`,
      `--port=${process.env.DB_PORT}`,
      `--user=${process.env.DB_USER}`,
      "--single-transaction",
      "--quick",
      "--skip-lock-tables",
      "--set-gtid-purged=OFF",
      "--no-tablespaces",
      "--routines",
      "--events",
      "--triggers",
      "--default-character-set=utf8mb4",
      "--hex-blob",
      process.env.DB_NAME,
    ];

    const proceso = spawn("mysqldump", argumentos, {
      env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" },
    });

    const salida = fsSync.createWriteStream(destino);
    let stderr = "";
    let terminado = false;

    const salidaLista = new Promise((listo, fallo) => {
      salida.on("finish", listo);
      salida.on("error", fallo);
    });

    proceso.stdout.pipe(salida);

    proceso.stderr.on("data", (dato) => {
      stderr += dato.toString();
    });

    proceso.on("error", (error) => {
      if (terminado) {
        return;
      }

      terminado = true;
      reject(
        new Error(
          `No se pudo ejecutar mysqldump. ¿Está instalado el cliente de MySQL? ${error.message}`,
        ),
      );
    });

    proceso.on("close", async (codigo) => {
      if (terminado) {
        return;
      }

      terminado = true;

      if (codigo !== 0) {
        salida.destroy();
        reject(
          new Error(
            `mysqldump terminó con código ${codigo}: ${stderr.trim()}`,
          ),
        );
        return;
      }

      try {
        await salidaLista;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function verificarSql(ruta, conteos = null) {
  const resultado = crearResultadoVerificacion();
  const stats = await fs.stat(ruta);

  anotar(
    resultado,
    "Archivo SQL no vacío",
    stats.size > 0,
    `${stats.size} bytes`,
  );

  const contenido = await fs.readFile(ruta, "utf8");

  anotar(
    resultado,
    "Contiene estructura (CREATE TABLE)",
    /CREATE TABLE/i.test(contenido),
    /CREATE TABLE/i.test(contenido) ? "sí" : "no",
  );

  anotar(
    resultado,
    "Contiene datos (INSERT INTO)",
    /INSERT INTO/i.test(contenido),
    /INSERT INTO/i.test(contenido) ? "sí" : "no",
  );

  for (const tabla of TABLAS_RESPALDO) {
    const tieneTabla = contenido.includes(`CREATE TABLE \`${tabla}\``);
    anotar(
      resultado,
      `Tabla ${tabla}`,
      tieneTabla,
      tieneTabla ? "incluida" : "no incluida",
    );

    if (
      tieneTabla &&
      conteos &&
      Number(conteos[tabla] || 0) > 0 &&
      !contenido.includes(`INSERT INTO \`${tabla}\``)
    ) {
      anotar(
        resultado,
        `Datos de ${tabla}`,
        false,
        "la tabla tiene registros pero el volcado no incluye INSERT",
      );
    }
  }

  anotar(
    resultado,
    "Sin credenciales en el archivo",
    !/DB_PASSWORD|GOOGLE_API_KEY|GOOGLE_DRIVE_CLIENT_SECRET/i.test(
      contenido,
    ),
    "no se han encontrado secretos de configuración",
  );

  return { ...resultado, tamano: stats.size };
}

async function contarRegistros() {
  const conteos = {};

  for (const tabla of TABLAS_RESPALDO) {
    const [filas] = await db.query(`SELECT COUNT(*) AS total FROM \`${tabla}\``);
    conteos[tabla] = Number(filas[0].total);
  }

  return conteos;
}

async function crearSqlBackup({ tipo = "sql" } = {}) {
  await asegurarDirectorios();

  const nombre = `base_datos_completa_${fechaParaNombre()}.sql`;
  const ruta = path.join(BACKUP_DIR, nombre);

  await ejecutarMysqldump(ruta);

  const conteos = await contarRegistros();
  const verificacion = await verificarSql(ruta, conteos);
  const stats = await fs.stat(ruta);

  const entrada = {
    id: crypto.randomUUID(),
    nombre,
    tipo,
    fecha: new Date().toISOString(),
    tamano: stats.size,
    estado: verificacion.ok ? "completada" : "con_errores",
    verificacion,
    archivos: [nombre],
    resumen: { registros: conteos },
  };

  await registrarBackup(entrada);

  return entrada;
}

// ============================================
// ZIP COMPLETO
// ============================================

function crearReadme({ datos, conteos, versionDb, fecha }) {
  return [
    `${NOMBRE_APP} · Copia de seguridad completa`,
    "============================================",
    "",
    `Fecha y hora de creación: ${fecha.toLocaleString("es-ES")}`,
    `Versión de la aplicación: ${APP_VERSION}`,
    `Motor de base de datos: MySQL ${versionDb || "(versión no disponible)"}`,
    "",
    "Contenido del ZIP",
    "-----------------",
    "clientes_casas.xlsx      Clientes/casas, actividad y resumen mensual.",
    "trabajadores.xlsx        Datos, historial de trabajo y resumen de horas.",
    "servicios_historial.xlsx Todos los servicios y sus resúmenes.",
    "base_datos_completa.sql  Estructura y datos completos de MySQL.",
    "README.txt               Este archivo.",
    "",
    "Datos incluidos",
    "---------------",
    `Clientes/casas exportados: ${datos.casas.length}`,
    `Trabajadores exportados: ${datos.trabajadores.length}`,
    `Servicios exportados: ${datos.servicios.length}`,
    `Registros por tabla: ${TABLAS_RESPALDO.map(
      (tabla) => `${tabla}=${conteos[tabla] || 0}`,
    ).join(", ")}`,
    "",
    "Restauración del respaldo SQL",
    "-----------------------------",
    "1. Detén la aplicación para evitar escrituras durante la restauración.",
    "2. Guarda una copia del estado actual (la aplicación la crea antes de restaurar).",
    "3. Ejecuta, desde la carpeta del backend y con las credenciales del .env:",
    "",
    "   mysql -h HOST -P PUERTO -u USUARIO -p NOMBRE_BASE < base_datos_completa.sql",
    "",
    "4. Arranca de nuevo el backend y comprueba el historial y los totales.",
    "",
    "También puedes usar la opción \"Restaurar\" del apartado Copias de seguridad.",
    "El archivo SQL no contiene contraseñas ni claves API.",
    "",
  ].join("\n");
}

async function obtenerVersionDb() {
  try {
    const [filas] = await db.query("SELECT VERSION() AS version");
    return filas[0]?.version || null;
  } catch {
    return null;
  }
}

async function crearZip(destino, archivos) {
  const salida = fsSync.createWriteStream(destino);
  const archivo = archiver("zip", { zlib: { level: 9 } });

  const finalizado = new Promise((resolve, reject) => {
    salida.on("close", resolve);
    archivo.on("error", reject);
    archivo.on("warning", (error) => {
      if (error.code !== "ENOENT") {
        reject(error);
      }
    });
  });

  archivo.pipe(salida);

  for (const elemento of archivos) {
    if (elemento.ruta) {
      archivo.file(elemento.ruta, { name: elemento.nombre });
    } else {
      archivo.append(elemento.buffer, { name: elemento.nombre });
    }
  }

  await archivo.finalize();
  await finalizado;
}

async function verificarZip(ruta, nombresEsperados) {
  const resultado = crearResultadoVerificacion();
  const stats = await fs.stat(ruta);

  anotar(
    resultado,
    "Archivo ZIP no vacío",
    stats.size > 0,
    `${stats.size} bytes`,
  );

  const zip = await JSZip.loadAsync(await fs.readFile(ruta));

  for (const nombre of nombresEsperados) {
    const entrada = zip.file(nombre);
    const contenido = entrada ? await entrada.async("nodebuffer") : null;
    const ok = Boolean(contenido && contenido.length > 0);

    anotar(
      resultado,
      `Archivo ${nombre}`,
      ok,
      ok ? `${contenido.length} bytes` : "no encontrado o vacío",
    );
  }

  return { ...resultado, tamano: stats.size };
}

async function crearBackupCompleto({ tipo = "completa" } = {}) {
  await asegurarDirectorios();

  const snapshot = await obtenerSnapshot();
  const conteos = await contarRegistros();
  const versionDb = await obtenerVersionDb();

  const excelClientes = await crearExcelClientesCasas(snapshot);
  const excelTrabajadores = await crearExcelTrabajadores(snapshot);
  const excelServicios = await crearExcelServicios(snapshot);

  const nombreSql = `base_datos_completa_${fechaParaNombre()}.sql`;
  const rutaSql = path.join(BACKUP_DIR, nombreSql);
  await ejecutarMysqldump(rutaSql);
  const verificacionSql = await verificarSql(rutaSql, conteos);

  const readme = crearReadme({
    datos: snapshot,
    conteos,
    versionDb,
    fecha: new Date(),
  });

  const nombre = `Backup_${NOMBRE_APP.replace(/\s+/g, "_")}_${fechaParaNombre()}.zip`;
  const ruta = path.join(BACKUP_DIR, nombre);

  await crearZip(ruta, [
    { nombre: excelClientes.nombre, buffer: excelClientes.buffer },
    { nombre: excelTrabajadores.nombre, buffer: excelTrabajadores.buffer },
    { nombre: excelServicios.nombre, buffer: excelServicios.buffer },
    { nombre: "base_datos_completa.sql", ruta: rutaSql },
    { nombre: "README.txt", buffer: Buffer.from(readme, "utf8") },
  ]);

  const verificacionZip = await verificarZip(ruta, [
    "clientes_casas.xlsx",
    "trabajadores.xlsx",
    "servicios_historial.xlsx",
    "base_datos_completa.sql",
    "README.txt",
  ]);

  const verificacion = {
    ok:
      verificacionZip.ok &&
      verificacionSql.ok &&
      excelClientes.verificacion.ok &&
      excelTrabajadores.verificacion.ok &&
      excelServicios.verificacion.ok,
    comprobaciones: [
      ...verificacionZip.comprobaciones,
      ...verificacionSql.comprobaciones,
      ...excelClientes.verificacion.comprobaciones,
      ...excelTrabajadores.verificacion.comprobaciones,
      ...excelServicios.verificacion.comprobaciones,
    ],
    errores: [
      ...verificacionZip.errores,
      ...verificacionSql.errores,
      ...excelClientes.verificacion.errores,
      ...excelTrabajadores.verificacion.errores,
      ...excelServicios.verificacion.errores,
    ],
  };

  const stats = await fs.stat(ruta);

  // El SQL suelto se conserva para poder restaurarlo o descargarlo aparte.
  const entradaSql = {
    id: crypto.randomUUID(),
    nombre: nombreSql,
    tipo: "sql",
    fecha: new Date().toISOString(),
    tamano: (await fs.stat(rutaSql)).size,
    estado: verificacionSql.ok ? "completada" : "con_errores",
    verificacion: verificacionSql,
    archivos: [nombreSql],
    resumen: { registros: conteos },
  };

  const entrada = {
    id: crypto.randomUUID(),
    nombre,
    tipo,
    fecha: new Date().toISOString(),
    tamano: stats.size,
    estado: verificacion.ok ? "completada" : "con_errores",
    verificacion,
    archivos: [
      excelClientes.nombre,
      excelTrabajadores.nombre,
      excelServicios.nombre,
      "base_datos_completa.sql",
      "README.txt",
    ],
    resumen: {
      casas: snapshot.casas.length,
      trabajadores: snapshot.trabajadores.length,
      servicios: snapshot.servicios.length,
      minutos_servicio: snapshot.totalMinutosServicio,
      minutos_individuales: snapshot.totalMinutosIndividuales,
      registros: conteos,
    },
  };

  await registrarBackup(entradaSql);
  await registrarBackup(entrada);

  return entrada;
}

// ============================================
// HISTORIAL (index.json)
// ============================================

async function leerIndice() {
  await asegurarDirectorios();

  try {
    const contenido = await fs.readFile(INDEX_FILE, "utf8");
    const datos = JSON.parse(contenido);
    return Array.isArray(datos) ? datos : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function guardarIndice(entradas) {
  await escribirJsonAtomico(INDEX_FILE, entradas);
}

async function registrarBackup(entrada) {
  const entradas = await leerIndice();
  entradas.unshift(entrada);
  await guardarIndice(entradas);
  return entrada;
}

async function listarBackups() {
  const entradas = await leerIndice();
  const resultado = [];

  for (const entrada of entradas) {
    const ruta = path.join(BACKUP_DIR, path.basename(entrada.nombre));
    let disponible = false;

    try {
      const stats = await fs.stat(ruta);
      disponible = stats.isFile() && stats.size > 0;
    } catch {
      disponible = false;
    }

    resultado.push({ ...entrada, disponible });
  }

  return resultado.sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
  );
}

async function obtenerBackup(nombre) {
  const seguro = path.basename(String(nombre || ""));
  const entradas = await leerIndice();
  const entrada = entradas.find((item) => item.nombre === seguro);

  if (!entrada) {
    return null;
  }

  const ruta = path.join(BACKUP_DIR, seguro);

  try {
    const stats = await fs.stat(ruta);

    if (!stats.isFile()) {
      return null;
    }

    return { entrada, ruta, tamano: stats.size };
  } catch {
    return null;
  }
}

async function verificarBackupGuardado(nombre) {
  const backup = await obtenerBackup(nombre);

  if (!backup) {
    const error = new Error("Copia de seguridad no encontrada");
    error.status = 404;
    throw error;
  }

  if (backup.entrada.nombre.toLowerCase().endsWith(".sql")) {
    const conteos = await contarRegistros();
    const verificacion = await verificarSql(backup.ruta, conteos);
    return { ...verificacion, nombre: backup.entrada.nombre };
  }

  if (backup.entrada.nombre.toLowerCase().endsWith(".zip")) {
    const verificacion = await verificarZip(backup.ruta, [
      "clientes_casas.xlsx",
      "trabajadores.xlsx",
      "servicios_historial.xlsx",
      "base_datos_completa.sql",
      "README.txt",
    ]);
    return { ...verificacion, nombre: backup.entrada.nombre };
  }

  return {
    ok: false,
    nombre: backup.entrada.nombre,
    comprobaciones: [],
    errores: ["Tipo de archivo no reconocido"],
  };
}

// ============================================
// CONFIGURACIÓN Y RETENCIÓN
// ============================================

const CONFIG_POR_DEFECTO = {
  automatico: {
    activo: false,
    frecuencia: "diaria",
    hora: "02:00",
    diaSemana: 1,
    retencion: 0,
    carpetaDestino: "",
  },
  ultimaEjecucion: null,
};

async function obtenerConfiguracion() {
  await asegurarDirectorios();

  try {
    const contenido = await fs.readFile(CONFIG_FILE, "utf8");
    const config = JSON.parse(contenido);

    return {
      ...CONFIG_POR_DEFECTO,
      ...config,
      automatico: {
        ...CONFIG_POR_DEFECTO.automatico,
        ...(config.automatico || {}),
      },
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ...CONFIG_POR_DEFECTO, automatico: { ...CONFIG_POR_DEFECTO.automatico } };
    }

    throw error;
  }
}

async function guardarConfiguracion(config) {
  const actual = await obtenerConfiguracion();
  const fusionada = {
    ...actual,
    ...config,
    automatico: {
      ...actual.automatico,
      ...(config.automatico || {}),
    },
  };

  const hora = String(fusionada.automatico.hora || "02:00");

  if (!/^\d{2}:\d{2}$/.test(hora)) {
    const error = new Error("La hora debe tener el formato HH:MM");
    error.status = 400;
    throw error;
  }

  const frecuencia = fusionada.automatico.frecuencia;

  if (!["diaria", "semanal"].includes(frecuencia)) {
    const error = new Error("La frecuencia debe ser diaria o semanal");
    error.status = 400;
    throw error;
  }

  const diaSemana = Number(fusionada.automatico.diaSemana);
  const retencion = Number(fusionada.automatico.retencion);

  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    const error = new Error("El día de la semana debe estar entre 0 y 6");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(retencion) || retencion < 0) {
    const error = new Error("La retención debe ser un número entero >= 0");
    error.status = 400;
    throw error;
  }

  fusionada.automatico.diaSemana = diaSemana;
  fusionada.automatico.retencion = retencion;
  fusionada.automatico.hora = hora;
  fusionada.automatico.activo = Boolean(fusionada.automatico.activo);

  await escribirJsonAtomico(CONFIG_FILE, fusionada);

  return fusionada;
}

async function aplicarRetencion(retencion) {
  const limite = Number(retencion);

  if (!Number.isInteger(limite) || limite <= 0) {
    return [];
  }

  const entradas = await leerIndice();
  const automaticas = entradas
    .filter((entrada) => entrada.tipo === "automatica")
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const eliminar = automaticas.slice(limite);

  if (eliminar.length === 0) {
    return [];
  }

  const nombres = new Set(eliminar.map((entrada) => entrada.nombre));
  const conservadas = entradas.filter(
    (entrada) => !nombres.has(entrada.nombre),
  );

  await guardarIndice(conservadas);

  for (const entrada of eliminar) {
    try {
      await fs.unlink(path.join(BACKUP_DIR, path.basename(entrada.nombre)));
    } catch {
      // Si el archivo ya no existe, la entrada se elimina igualmente.
    }
  }

  return eliminar.map((entrada) => entrada.nombre);
}

async function copiarACarpetaDestino(entrada, carpeta) {
  if (!carpeta) {
    return null;
  }

  const destino = path.resolve(carpeta);
  await fs.mkdir(destino, { recursive: true });

  const origen = path.join(BACKUP_DIR, path.basename(entrada.nombre));
  const rutaDestino = path.join(destino, path.basename(entrada.nombre));

  await fs.copyFile(origen, rutaDestino);

  return rutaDestino;
}

// ============================================
// PROGRAMADOR DE COPIAS AUTOMÁTICAS
// ============================================

function calcularVencimiento(automatico, ahora = new Date()) {
  const [hora, minuto] = String(automatico.hora || "02:00")
    .split(":")
    .map(Number);

  const vencimiento = new Date(ahora);
  vencimiento.setHours(hora, minuto, 0, 0);

  if (automatico.frecuencia === "semanal") {
    const diaObjetivo = Number(automatico.diaSemana);
    const diferencia = (vencimiento.getDay() - diaObjetivo + 7) % 7;
    vencimiento.setDate(vencimiento.getDate() - diferencia);

    if (vencimiento > ahora) {
      vencimiento.setDate(vencimiento.getDate() - 7);
    }

    return vencimiento;
  }

  if (vencimiento > ahora) {
    vencimiento.setDate(vencimiento.getDate() - 1);
  }

  return vencimiento;
}

let programadorIniciado = false;
let ejecucionEnCurso = false;

async function ejecutarBackupAutomatico({ forzar = false } = {}) {
  const config = await obtenerConfiguracion();
  const automatico = config.automatico;

  if (!forzar && !automatico.activo) {
    return null;
  }

  const ahora = new Date();
  const vencimiento = calcularVencimiento(automatico, ahora);
  const ultima = config.ultimaEjecucion
    ? new Date(config.ultimaEjecucion)
    : null;

  if (!forzar && ultima && ultima >= vencimiento) {
    return null;
  }

  if (!forzar) {
    const entradas = await listarBackups();
    const yaHecha = entradas.some(
      (entrada) =>
        entrada.tipo === "automatica" &&
        new Date(entrada.fecha) >= vencimiento,
    );

    if (yaHecha) {
      await guardarConfiguracion({
        ...config,
        ultimaEjecucion: vencimiento.toISOString(),
      });
      return null;
    }
  }

  ejecucionEnCurso = true;

  try {
    const entrada = await crearBackupCompleto({ tipo: "automatica" });

    if (automatico.carpetaDestino) {
      await copiarACarpetaDestino(entrada, automatico.carpetaDestino);
    }

    await aplicarRetencion(automatico.retencion);
    await guardarConfiguracion({
      ...config,
      ultimaEjecucion: new Date().toISOString(),
    });

    return entrada;
  } finally {
    ejecucionEnCurso = false;
  }
}

async function revisarProgramacion() {
  if (ejecucionEnCurso) {
    return;
  }

  try {
    await ejecutarBackupAutomatico();
  } catch (error) {
    console.error("Error en la copia automática programada:", error.message);
  }
}

function iniciarProgramador() {
  if (programadorIniciado) {
    return;
  }

  programadorIniciado = true;

  const temporizador = setInterval(revisarProgramacion, 60 * 1000);

  if (typeof temporizador.unref === "function") {
    temporizador.unref();
  }

  const arranque = setTimeout(revisarProgramacion, 5000);

  if (typeof arranque.unref === "function") {
    arranque.unref();
  }

  console.log("Programador de copias automáticas iniciado.");
}

// ============================================
// RESTAURACIÓN
// ============================================

function importarSql(ruta, baseDatos = process.env.DB_NAME) {
  return new Promise((resolve, reject) => {
    const argumentos = [
      `--host=${process.env.DB_HOST}`,
      `--port=${process.env.DB_PORT}`,
      `--user=${process.env.DB_USER}`,
      "--default-character-set=utf8mb4",
      baseDatos,
    ];

    const proceso = spawn("mysql", argumentos, {
      env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" },
    });

    let stderr = "";

    proceso.stderr.on("data", (dato) => {
      stderr += dato.toString();
    });

    proceso.on("error", (error) => {
      reject(
        new Error(
          `No se pudo ejecutar mysql. ¿Está instalado el cliente de MySQL? ${error.message}`,
        ),
      );
    });

    proceso.on("close", (codigo) => {
      if (codigo !== 0) {
        reject(new Error(`La restauración falló: ${stderr.trim()}`));
        return;
      }

      resolve();
    });

    fsSync.createReadStream(ruta).pipe(proceso.stdin);
  });
}

async function extraerSqlDeZip(rutaZip) {
  const zip = await JSZip.loadAsync(await fs.readFile(rutaZip));
  const entrada = zip.file("base_datos_completa.sql");

  if (!entrada) {
    const error = new Error(
      "El ZIP no contiene base_datos_completa.sql",
    );
    error.status = 400;
    throw error;
  }

  const contenido = await entrada.async("nodebuffer");
  const ruta = path.join(TEMP_DIR, `restauracion_${fechaParaNombre()}.sql`);

  await fs.writeFile(ruta, contenido);

  return ruta;
}

async function restaurarBackup(nombre, confirmacion) {
  if (confirmacion !== "RESTAURAR") {
    const error = new Error(
      'Debes escribir "RESTAURAR" para confirmar la restauración',
    );
    error.status = 400;
    throw error;
  }

  const backup = await obtenerBackup(nombre);

  if (!backup) {
    const error = new Error("Copia de seguridad no encontrada");
    error.status = 404;
    throw error;
  }

  let rutaSql = backup.ruta;

  if (backup.entrada.nombre.toLowerCase().endsWith(".zip")) {
    rutaSql = await extraerSqlDeZip(backup.ruta);
  }

  if (!rutaSql.toLowerCase().endsWith(".sql")) {
    const error = new Error(
      "Solo se pueden restaurar archivos SQL o ZIP con base_datos_completa.sql",
    );
    error.status = 400;
    throw error;
  }

  // Copia de seguridad previa por si la restauración no es la esperada.
  let seguridad = null;

  try {
    seguridad = await crearSqlBackup({ tipo: "pre-restauracion" });
  } catch (error) {
    console.warn(
      "No se pudo crear la copia previa a la restauración:",
      error.message,
    );
  }

  await importarSql(rutaSql);

  const conteos = await contarRegistros();
  const [comprobacion] = await db.query("SELECT 1 AS ok");

  return {
    ok: comprobacion[0]?.ok === 1,
    mensaje: "Base de datos restaurada y comprobada correctamente",
    nombre: backup.entrada.nombre,
    copia_previa: seguridad ? seguridad.nombre : null,
    conteos,
  };
}

// Restauración de prueba en una base de datos temporal aislada. No toca la
// base de datos real: crea una base `horarios_app_verif_*`, importa el SQL,
// compara los recuentos y la elimina al terminar.
async function probarRestauracionSql(nombre) {
  const backup = await obtenerBackup(nombre);

  if (!backup) {
    const error = new Error("Copia de seguridad no encontrada");
    error.status = 404;
    throw error;
  }

  let rutaSql = backup.ruta;
  let temporal = null;

  if (backup.entrada.nombre.toLowerCase().endsWith(".zip")) {
    rutaSql = await extraerSqlDeZip(backup.ruta);
    temporal = rutaSql;
  }

  if (!rutaSql.toLowerCase().endsWith(".sql")) {
    const error = new Error("La copia no contiene un archivo SQL restaurable");
    error.status = 400;
    throw error;
  }

  const baseTemporal = `horarios_app_verif_${Date.now()}`;
  const resultado = crearResultadoVerificacion();

  try {
    await db.query(
      `CREATE DATABASE \`${baseTemporal}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    await importarSql(rutaSql, baseTemporal);

    const conexion = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: baseTemporal,
      port: process.env.DB_PORT,
    });

    const conteos = {};

    try {
      for (const tabla of TABLAS_RESPALDO) {
        const [filas] = await conexion.query(
          `SELECT COUNT(*) AS total FROM \`${tabla}\``,
        );
        conteos[tabla] = Number(filas[0].total);
      }
    } finally {
      await conexion.end();
    }

    const esperados = backup.entrada.resumen?.registros || null;

    anotar(
      resultado,
      "Base temporal creada e importada",
      true,
      baseTemporal,
    );

    for (const tabla of TABLAS_RESPALDO) {
      const recuperados = conteos[tabla];
      const ok =
        esperados && tabla in esperados
          ? recuperados === Number(esperados[tabla])
          : recuperados >= 0;

      anotar(
        resultado,
        `Tabla ${tabla} recuperada`,
        ok,
        esperados && tabla in esperados
          ? `${recuperados} registros (esperados ${esperados[tabla]})`
          : `${recuperados} registros`,
      );
    }

    anotar(
      resultado,
      "La copia contiene servicios",
      conteos.horarios > 0,
      `${conteos.horarios} servicios`,
    );

    return {
      ...resultado,
      nombre: backup.entrada.nombre,
      base_temporal: baseTemporal,
      conteos,
      esperados,
    };
  } finally {
    try {
      await db.query(`DROP DATABASE IF EXISTS \`${baseTemporal}\``);
    } catch (error) {
      console.warn(
        `No se pudo eliminar la base temporal ${baseTemporal}:`,
        error.message,
      );
    }

    if (temporal) {
      try {
        await fs.unlink(temporal);
      } catch {
        // El archivo temporal ya no existe.
      }
    }
  }
}

// ============================================
// GOOGLE DRIVE (OAuth 2.0 + API REST)
// ============================================const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let estadoOAuthPendiente = null;

function configuracionDrive() {
  return {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_DRIVE_REDIRECT_URI ||
      "http://localhost:3000/api/backups/google-drive/callback",
  };
}

async function leerTokensDrive() {
  try {
    return JSON.parse(await fs.readFile(DRIVE_TOKENS_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function guardarTokensDrive(tokens) {
  await asegurarDirectorios();
  await fs.writeFile(DRIVE_TOKENS_FILE, JSON.stringify(tokens, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function estadoGoogleDrive() {
  const config = configuracionDrive();
  const configurado = Boolean(config.clientId && config.clientSecret);
  const tokens = await leerTokensDrive();

  return {
    configurado,
    conectado: Boolean(tokens && tokens.refresh_token),
    redirect_uri: config.redirectUri,
    actualizado: tokens?.fecha_actualizacion || null,
  };
}

function urlAutorizacionGoogleDrive() {
  const config = configuracionDrive();

  if (!config.clientId || !config.clientSecret) {
    const error = new Error(
      "Google Drive no está configurado. Define GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET en backend/.env",
    );
    error.status = 503;
    throw error;
  }

  const state = crypto.randomBytes(24).toString("hex");
  estadoOAuthPendiente = { state, creado: Date.now() };

  const parametros = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${parametros.toString()}`;
}

async function procesarCallbackGoogleDrive(code, state) {
  if (
    !estadoOAuthPendiente ||
    estadoOAuthPendiente.state !== state ||
    Date.now() - estadoOAuthPendiente.creado > 10 * 60 * 1000
  ) {
    const error = new Error("Estado OAuth inválido o caducado");
    error.status = 400;
    throw error;
  }

  estadoOAuthPendiente = null;

  const config = configuracionDrive();
  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      `Google rechazó la autorización: ${
        datos.error_description || datos.error || respuesta.status
      }`,
    );
  }

  await guardarTokensDrive({
    ...datos,
    fecha_actualizacion: new Date().toISOString(),
  });

  return true;
}

async function desconectarGoogleDrive() {
  try {
    await fs.unlink(DRIVE_TOKENS_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function obtenerAccessTokenDrive() {
  const config = configuracionDrive();
  const tokens = await leerTokensDrive();

  if (!tokens) {
    const error = new Error(
      "Google Drive no está conectado. Autoriza la integración primero.",
    );
    error.status = 401;
    throw error;
  }

  const caducado =
    !tokens.expiry_date || Number(tokens.expiry_date) <= Date.now() + 60000;

  if (!caducado) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    const error = new Error(
      "El token de Google Drive ha caducado y no hay refresh_token. Vuelve a autorizar.",
    );
    error.status = 401;
    throw error;
  }

  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      `No se pudo renovar el token de Google: ${
        datos.error_description || datos.error || respuesta.status
      }`,
    );
  }

  const actualizados = {
    ...tokens,
    ...datos,
    refresh_token: tokens.refresh_token,
    fecha_actualizacion: new Date().toISOString(),
  };

  await guardarTokensDrive(actualizados);

  return actualizados.access_token;
}

async function peticionDrive(ruta, opciones = {}) {
  const accessToken = await obtenerAccessTokenDrive();
  const respuesta = await fetch(`https://www.googleapis.com${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(opciones.headers || {}),
    },
  });

  const texto = await respuesta.text();
  let datos = null;

  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = { raw: texto };
  }

  if (!respuesta.ok) {
    throw new Error(
      `Error de Google Drive (${respuesta.status}): ${
        datos?.error?.message || texto
      }`,
    );
  }

  return datos;
}

async function buscarOCrearCarpetaDrive(nombre, padreId = null) {
  const consulta = [
    `name='${nombre.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ];

  if (padreId) {
    consulta.push(`'${padreId}' in parents`);
  }

  const datos = await peticionDrive(
    `/drive/v3/files?q=${encodeURIComponent(
      consulta.join(" and "),
    )}&fields=files(id,name)&pageSize=1`,
  );

  if (datos.files && datos.files.length > 0) {
    return datos.files[0].id;
  }

  const creada = await peticionDrive("/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: nombre,
      mimeType: "application/vnd.google-apps.folder",
      ...(padreId ? { parents: [padreId] } : {}),
    }),
  });

  return creada.id;
}

async function buscarArchivoDrive(nombre, padreId) {
  const consulta = `name='${nombre.replace(/'/g, "\\'")}' and '${padreId}' in parents and trashed=false`;
  const datos = await peticionDrive(
    `/drive/v3/files?q=${encodeURIComponent(
      consulta,
    )}&fields=files(id,name,webViewLink)&pageSize=1`,
  );

  return datos.files && datos.files.length > 0 ? datos.files[0] : null;
}

async function subirArchivoDrive(nombre, ruta, padreId) {
  const existente = await buscarArchivoDrive(nombre, padreId);

  if (existente) {
    return { duplicado: true, ...existente };
  }

  const contenido = await fs.readFile(ruta);
  const boundary = `----claudia-${Date.now()}`;
  const metadatos = JSON.stringify({ name: nombre, parents: [padreId] });

  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadatos}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    contenido,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const datos = await peticionDrive(
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: cuerpo,
    },
  );

  return { duplicado: false, ...datos };
}

async function subirBackupGoogleDrive(nombre) {
  const backup = await obtenerBackup(nombre);

  if (!backup) {
    const error = new Error("Copia de seguridad no encontrada");
    error.status = 404;
    throw error;
  }

  const carpetaRaiz = await buscarOCrearCarpetaDrive(NOMBRE_APP);
  const fechaCarpeta = new Date(backup.entrada.fecha);
  const nombreCarpetaFecha = `${fechaCarpeta.getFullYear()}-${String(
    fechaCarpeta.getMonth() + 1,
  ).padStart(2, "0")}-${String(fechaCarpeta.getDate()).padStart(2, "0")}`;
  const carpetaFecha = await buscarOCrearCarpetaDrive(
    nombreCarpetaFecha,
    carpetaRaiz,
  );

  const subido = await subirArchivoDrive(
    backup.entrada.nombre,
    backup.ruta,
    carpetaFecha,
  );

  const entradas = await leerIndice();
  const indice = entradas.findIndex(
    (entrada) => entrada.nombre === backup.entrada.nombre,
  );

  if (indice >= 0) {
    entradas[indice] = {
      ...entradas[indice],
      drive: {
        subido: true,
        duplicado: subido.duplicado,
        id: subido.id,
        webViewLink: subido.webViewLink || null,
        fecha: new Date().toISOString(),
        carpeta: `${NOMBRE_APP}/${nombreCarpetaFecha}`,
      },
    };
    await guardarIndice(entradas);
  }

  return {
    ok: true,
    nombre: backup.entrada.nombre,
    duplicado: subido.duplicado,
    id: subido.id,
    webViewLink: subido.webViewLink || null,
    carpeta: `${NOMBRE_APP}/${nombreCarpetaFecha}`,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  BACKUP_DIR,
  APP_VERSION,
  obtenerSnapshot,
  crearExcelClientesCasas,
  crearExcelTrabajadores,
  crearExcelServicios,
  crearSqlBackup,
  crearBackupCompleto,
  listarBackups,
  obtenerBackup,
  verificarBackupGuardado,
  obtenerConfiguracion,
  guardarConfiguracion,
  aplicarRetencion,
  iniciarProgramador,
  ejecutarBackupAutomatico,
  restaurarBackup,
  probarRestauracionSql,
  estadoGoogleDrive,
  urlAutorizacionGoogleDrive,
  procesarCallbackGoogleDrive,
  desconectarGoogleDrive,
  subirBackupGoogleDrive,
};
