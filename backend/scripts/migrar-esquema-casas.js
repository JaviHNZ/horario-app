#!/usr/bin/env node
"use strict";

/**
 * Migración de esquema para los datos reales (Fase 2).
 *
 * Solo AÑADE columnas. No elimina ni renombra nada, no toca claves foráneas
 * ni índices, y es idempotente: si una columna ya existe, se salta.
 *
 * Uso:
 *   node backend/scripts/migrar-esquema-casas.js            (simulación)
 *   node backend/scripts/migrar-esquema-casas.js --ejecutar (aplica)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const db = require("../src/config/db");

const COLUMNAS_CASAS = [
  ["nombre_cliente", "VARCHAR(150) NULL AFTER `nombre`"],
  ["apellidos_cliente", "VARCHAR(150) NULL AFTER `nombre_cliente`"],
  ["contacto", "VARCHAR(20) NULL AFTER `direccion`"],
  ["codigo_postal", "VARCHAR(10) NULL AFTER `contacto`"],
  ["poblacion", "VARCHAR(100) NULL AFTER `codigo_postal`"],
  ["tipo", "VARCHAR(30) NULL AFTER `poblacion`"],
  ["frecuencia_texto", "VARCHAR(50) NULL AFTER `tipo`"],
  ["visitas_por_periodo", "TINYINT UNSIGNED NULL AFTER `frecuencia_texto`"],
  ["periodo_dias", "SMALLINT UNSIGNED NULL AFTER `visitas_por_periodo`"],
  ["precio_hora", "DECIMAL(6,2) NULL AFTER `periodo_dias`"],
  ["emite_factura", "TINYINT(1) NOT NULL DEFAULT 0 AFTER `precio_hora`"],
  ["observaciones", "TEXT NULL AFTER `emite_factura`"],
  ["datos_pendientes", "TINYINT(1) NOT NULL DEFAULT 0 AFTER `observaciones`"],
];

const COLUMNAS_TRABAJADORES = [
  ["apellidos", "VARCHAR(150) NULL AFTER `nombre`"],
  ["contacto", "VARCHAR(20) NULL AFTER `apellidos`"],
  ["direccion", "VARCHAR(255) NULL AFTER `contacto`"],
  ["poblacion", "VARCHAR(100) NULL AFTER `direccion`"],
  ["datos_pendientes", "TINYINT(1) NOT NULL DEFAULT 0 AFTER `poblacion`"],
];

async function columnasExistentes(tabla) {
  const [filas] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabla],
  );
  return new Set(filas.map((f) => f.COLUMN_NAME));
}

async function planificar(tabla, columnas) {
  const existentes = await columnasExistentes(tabla);
  const pendientes = columnas.filter(([nombre]) => !existentes.has(nombre));
  return { existentes, pendientes };
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");

  const casas = await planificar("casas", COLUMNAS_CASAS);
  const trabajadores = await planificar("trabajadores", COLUMNAS_TRABAJADORES);

  console.log(`Modo: ${ejecutar ? "EJECUTAR" : "simulación"}`);
  console.log(`\ncasas: ${casas.pendientes.length} columnas por añadir`);
  for (const [nombre, sql] of casas.pendientes) console.log(`  + ${nombre} ${sql}`);
  console.log(`trabajadores: ${trabajadores.pendientes.length} columnas por añadir`);
  for (const [nombre, sql] of trabajadores.pendientes) console.log(`  + ${nombre} ${sql}`);

  if (casas.pendientes.length === 0 && trabajadores.pendientes.length === 0) {
    console.log("\nEl esquema ya está actualizado. Nada que hacer.");
    return;
  }

  if (!ejecutar) {
    console.log("\nSimulación: no se ha modificado nada. Añade --ejecutar para aplicar.");
    return;
  }

  for (const [tabla, pendientes] of [
    ["casas", casas.pendientes],
    ["trabajadores", trabajadores.pendientes],
  ]) {
    for (const [nombre, definicion] of pendientes) {
      // `tabla` y `nombre` salen de una lista fija del propio script, no de
      // entrada del usuario; no hay riesgo de inyección.
      await db.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${nombre}\` ${definicion}`);
      console.log(`  aplicado: ${tabla}.${nombre}`);
    }
  }

  const despues = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('casas', 'trabajadores')
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );

  console.log("\nEsquema resultante:");
  for (const c of despues[0]) {
    console.log(
      `  ${c.TABLE_NAME}.${c.COLUMN_NAME}: ${c.COLUMN_TYPE} ` +
        `${c.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL"}` +
        `${c.COLUMN_DEFAULT !== null ? ` DEFAULT ${c.COLUMN_DEFAULT}` : ""}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error en la migración de esquema:", error.message);
    process.exit(1);
  });
