#!/usr/bin/env node
"use strict";

/**
 * Importación inicial de los datos reales (Fase 3).
 *
 * Sustituye los datos ficticios de MySQL por los 100 registros del Excel y
 * actualiza los trabajadores. Es la ÚNICA vez que se lee el Excel: a partir de
 * aquí las casas se gestionan desde la aplicación.
 *
 * Uso:
 *   node backend/scripts/03-importar-inicial.js            (simulación)
 *   node backend/scripts/03-importar-inicial.js --ejecutar (importa de verdad)
 *
 * Garantías:
 *  - Todo ocurre dentro de una transacción: si algo falla, no se guarda nada.
 *  - No borra tablas ni modifica su estructura.
 *  - Borra en el orden que respetan las claves foráneas.
 *  - No borra trabajadores: los actualiza, añade los nuevos y desactiva B y L.
 *  - Se niega a ejecutar si hay facturas reales (no ficticias) en la base.
 */

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("../src/config/db");
const {
  F_CLIENTES,
  F_TRABAJADORES,
  analizarClientes,
  analizarTrabajadores,
  leerHoja,
} = require("./importar-datos-reales");

// Deben coincidir con CAMPOS_OBLIGATORIOS de casas.routes.js.
const CAMPOS_OBLIGATORIOS_CASA = [
  "nombre_cliente",
  "contacto",
  "direccion",
  "frecuencia_texto",
  "precio_hora",
  "duracion_minutos",
];

const CAMPOS_OBLIGATORIOS_TRABAJADOR = [
  "apellidos",
  "contacto",
  "direccion",
  "poblacion",
];

const CODIGOS_A_DESACTIVAR = ["B", "L"];

const vacio = (valor) =>
  valor === null || valor === undefined || valor === "";

const calcularPendienteCasa = (casa) =>
  CAMPOS_OBLIGATORIOS_CASA.some((campo) => vacio(casa[campo])) ? 1 : 0;

const calcularPendienteTrabajador = (trabajador) =>
  CAMPOS_OBLIGATORIOS_TRABAJADOR.some((campo) => vacio(trabajador[campo]))
    ? 1
    : 0;

// Observaciones: se conservan las notas del Excel y las incidencias detectadas
// (frecuencia con errata, CP raro...). No se inventa nada.
function observacionesDe(registro) {
  const notas = [];

  if (registro.frecuencia_nota) notas.push(registro.frecuencia_nota);
  for (const incidencia of registro.incidencias || []) notas.push(incidencia);

  return notas.length > 0 ? notas.join(" · ") : null;
}

function aCasa(registro) {
  const casa = {
    nombre: registro.nombre_horario,
    nombre_cliente: registro.nombre,
    apellidos_cliente: registro.apellidos,
    direccion: registro.direccion,
    contacto: registro.contacto,
    codigo_postal: registro.codigo_postal,
    poblacion: registro.poblacion,
    tipo: registro.tipo,
    frecuencia_texto: registro.frecuencia_texto,
    visitas_por_periodo: registro.visitas_por_periodo,
    periodo_dias: registro.periodo_dias,
    precio_hora: registro.precio_hora,
    duracion_minutos: registro.duracion_referencia_minutos,
    emite_factura: registro.emite_factura ? 1 : 0,
    observaciones: observacionesDe(registro),
  };

  casa.datos_pendientes = calcularPendienteCasa(casa);

  return casa;
}

function aTrabajador(trabajador) {
  const datos = {
    nombre: trabajador.nombre,
    apellidos: trabajador.apellidos,
    contacto: trabajador.contacto,
    direccion: trabajador.direccion,
    poblacion: trabajador.poblacion,
  };

  datos.datos_pendientes = calcularPendienteTrabajador(datos);

  return datos;
}

async function columnasCasas() {
  const [filas] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'casas'`,
  );
  return new Set(filas.map((f) => f.COLUMN_NAME));
}

async function recuentos(conexion = db) {
  const tablas = [
    "casas",
    "trabajadores",
    "dias",
    "horarios",
    "horario_trabajadores",
    "facturas",
    "factura_detalles",
  ];

  const resultado = {};

  for (const tabla of tablas) {
    const [filas] = await conexion.query(`SELECT COUNT(*) AS total FROM \`${tabla}\``);
    resultado[tabla] = filas[0].total;
  }

  return resultado;
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");

  // -------------------------------------------------------------------------
  // 1. Leer el Excel con el mismo parser que la vista previa
  // -------------------------------------------------------------------------
  const lecturaClientes = await leerHoja(F_CLIENTES);
  const lecturaTrabajadores = await leerHoja(F_TRABAJADORES);

  const { registros } = analizarClientes(lecturaClientes.filas);
  const { trabajadores } = analizarTrabajadores(
    lecturaTrabajadores.filas,
    new Map(),
  );

  const casas = registros.map(aCasa);
  const nombres = casas.map((casa) => casa.nombre);

  // -------------------------------------------------------------------------
  // 2. Comprobaciones previas (no modifican nada)
  // -------------------------------------------------------------------------
  const columnas = await columnasCasas();
  const faltanColumnas = ["tipo", "precio_hora", "datos_pendientes"].filter(
    (columna) => !columnas.has(columna),
  );

  if (faltanColumnas.length > 0) {
    throw new Error(
      `Falta aplicar la migración de esquema (columnas: ${faltanColumnas.join(", ")}). ` +
        "Ejecuta antes: node backend/scripts/migrar-esquema-casas.js --ejecutar",
    );
  }

  if (casas.length !== 100) {
    throw new Error(
      `Se esperaban 100 registros de cliente y se han leído ${casas.length}.`,
    );
  }

  if (new Set(nombres).size !== nombres.length) {
    throw new Error(
      "Hay nombres de casa repetidos en el Excel y la columna casas.nombre es única.",
    );
  }

  const antes = await recuentos();

  if (antes.facturas > 0 || antes.factura_detalles > 0) {
    throw new Error(
      "Hay facturas en la base de datos. No se puede asumir que sean ficticias: " +
        "revisa y vacíalas manualmente antes de importar.",
    );
  }

  const [trabajadoresBd] = await db.query(
    "SELECT id, codigo, nombre, activo FROM trabajadores",
  );
  const porCodigo = new Map(
    trabajadoresBd.map((t) => [String(t.codigo).toUpperCase(), t]),
  );

  const aInsertar = trabajadores.filter(
    (t) => !porCodigo.has(t.codigo.toUpperCase()),
  );
  const aActualizar = trabajadores.filter((t) =>
    porCodigo.has(t.codigo.toUpperCase()),
  );
  const ausentes = trabajadoresBd.filter(
    (t) =>
      !trabajadores.some(
        (x) => x.codigo.toUpperCase() === String(t.codigo).toUpperCase(),
      ),
  );

  // -------------------------------------------------------------------------
  // 3. Plan
  // -------------------------------------------------------------------------
  console.log(`Modo: ${ejecutar ? "EJECUTAR (destructivo)" : "simulación"}\n`);

  console.log("Excel:");
  console.log(`  filas hoja clientes:    ${lecturaClientes.filasHoja} (1 cabecera + ${casas.length} registros)`);
  console.log(`  casas a importar:       ${casas.length}`);
  console.log(`  casas incompletas:      ${casas.filter((c) => c.datos_pendientes).length}`);
  console.log(`  trabajadores en Excel:  ${trabajadores.length}`);

  console.log("\nBase de datos (ahora):");
  console.log(`  casas: ${antes.casas} · horarios: ${antes.horarios} · dias: ${antes.dias}`);
  console.log(`  horario_trabajadores: ${antes.horario_trabajadores}`);
  console.log(`  facturas: ${antes.facturas} · factura_detalles: ${antes.factura_detalles}`);
  console.log(`  trabajadores: ${antes.trabajadores}`);

  console.log("\nSe eliminarán (datos ficticios), en este orden:");
  console.log(`  1. factura_detalles     ${antes.factura_detalles}`);
  console.log(`  2. facturas             ${antes.facturas}`);
  console.log(`  3. horario_trabajadores ${antes.horario_trabajadores}`);
  console.log(`  4. horarios             ${antes.horarios}`);
  console.log(`  5. dias                 ${antes.dias}`);
  console.log(`  6. casas                ${antes.casas}`);

  console.log("\nTrabajadores:");
  console.log(`  actualizar (mismo código): ${aActualizar.length} → ${aActualizar.map((t) => t.codigo).join(", ")}`);
  console.log(`  insertar (código nuevo):   ${aInsertar.length} → ${aInsertar.map((t) => t.codigo).join(", ")}`);
  console.log(`  desactivar (no están en el Excel): ${ausentes.length} → ${ausentes.map((t) => t.codigo).join(", ") || "ninguno"}`);
  console.log("  (ningún trabajador se borra)");

  if (!ejecutar) {
    console.log("\nSimulación: no se ha modificado nada.");
    console.log("Para ejecutar la importación: node backend/scripts/03-importar-inicial.js --ejecutar");
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Importación dentro de una transacción
  // -------------------------------------------------------------------------
  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    await conexion.query("DELETE FROM factura_detalles");
    await conexion.query("DELETE FROM facturas");
    await conexion.query("DELETE FROM horario_trabajadores");
    await conexion.query("DELETE FROM horarios");
    await conexion.query("DELETE FROM dias");
    await conexion.query("DELETE FROM casas");

    for (const casa of casas) {
      await conexion.query(
        `
        INSERT INTO casas (
          nombre,
          nombre_cliente,
          apellidos_cliente,
          direccion,
          contacto,
          codigo_postal,
          poblacion,
          tipo,
          frecuencia_texto,
          visitas_por_periodo,
          periodo_dias,
          precio_hora,
          duracion_minutos,
          emite_factura,
          observaciones,
          datos_pendientes,
          activo
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        [
          casa.nombre,
          casa.nombre_cliente,
          casa.apellidos_cliente,
          casa.direccion,
          casa.contacto,
          casa.codigo_postal,
          casa.poblacion,
          casa.tipo,
          casa.frecuencia_texto,
          casa.visitas_por_periodo,
          casa.periodo_dias,
          casa.precio_hora,
          casa.duracion_minutos,
          casa.emite_factura,
          casa.observaciones,
          casa.datos_pendientes,
        ],
      );
    }

    for (const trabajador of trabajadores) {
      const datos = aTrabajador(trabajador);
      const existente = porCodigo.get(trabajador.codigo.toUpperCase());

      if (existente) {
        await conexion.query(
          `
          UPDATE trabajadores
          SET nombre = ?, apellidos = ?, contacto = ?, direccion = ?,
              poblacion = ?, datos_pendientes = ?
          WHERE id = ?
          `,
          [
            datos.nombre,
            datos.apellidos,
            datos.contacto,
            datos.direccion,
            datos.poblacion,
            datos.datos_pendientes,
            existente.id,
          ],
        );
      } else {
        await conexion.query(
          `
          INSERT INTO trabajadores (
            nombre, apellidos, codigo, contacto, direccion, poblacion,
            datos_pendientes, activo
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `,
          [
            datos.nombre,
            datos.apellidos,
            trabajador.codigo.toUpperCase(),
            datos.contacto,
            datos.direccion,
            datos.poblacion,
            datos.datos_pendientes,
          ],
        );
      }
    }

    await conexion.query(
      `UPDATE trabajadores SET activo = 0 WHERE codigo IN (?)`,
      [CODIGOS_A_DESACTIVAR],
    );

    // Verificación antes de confirmar
    const despues = await recuentos(conexion);

    if (despues.casas !== casas.length) {
      throw new Error(
        `Verificación fallida: se esperaban ${casas.length} casas y hay ${despues.casas}.`,
      );
    }

    if (despues.horarios !== 0 || despues.dias !== 0) {
      throw new Error(
        "Verificación fallida: quedan horarios o días ficticios después de la limpieza.",
      );
    }

    if (despues.trabajadores < trabajadores.length) {
      throw new Error(
        "Verificación fallida: faltan trabajadores después de la importación.",
      );
    }

    await conexion.commit();

    console.log("\nImportación completada.");
    console.log(`  casas:                 ${despues.casas}`);
    console.log(`    pendientes:          ${casas.filter((c) => c.datos_pendientes).length}`);
    console.log(`  trabajadores:          ${despues.trabajadores}`);
    console.log(`  horarios / dias:       ${despues.horarios} / ${despues.dias}`);
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nError en la importación inicial:", error.message);
    console.error("No se ha confirmado ningún cambio (transacción revertida).");
    process.exit(1);
  });
