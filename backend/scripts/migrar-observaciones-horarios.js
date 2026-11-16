/**
 * Migración aditiva: añade `observaciones` a `horarios`.
 *
 * Motivo: la edición de un día y las exportaciones necesitan un campo de
 * observaciones por servicio. Es una columna NULL, así que no modifica ni
 * elimina ningún dato existente y es segura de ejecutar varias veces.
 *
 * Uso:
 *   node scripts/migrar-observaciones-horarios.js
 */
require("dotenv").config();

const db = require("../src/config/db");

async function main() {
  const [columnas] = await db.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'horarios'
      AND COLUMN_NAME = 'observaciones'
    `,
  );

  if (columnas.length > 0) {
    console.log("La columna horarios.observaciones ya existe. Nada que hacer.");
    return;
  }

  await db.query(
    `
    ALTER TABLE horarios
    ADD COLUMN observaciones VARCHAR(1000) NULL
    AFTER duracion_facturable_minutos
    `,
  );

  console.log("Columna horarios.observaciones añadida correctamente.");
}

main()
  .catch((error) => {
    console.error("Error aplicando la migración:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
