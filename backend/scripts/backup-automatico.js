/**
 * Ejecuta una copia automática desde el sistema operativo (cron, systemd, etc.).
 *
 * Uso:
 *   node scripts/backup-automatico.js
 *
 * Ejemplo de cron (todos los días a las 02:00, desde la carpeta backend):
 *   0 2 * * * cd /ruta/al/backend && /usr/bin/node scripts/backup-automatico.js >> backups/cron.log 2>&1
 *
 * Respeta la configuración guardada en backups/config.json (activación,
 * frecuencia, retención y carpeta de destino). Si la copia ya se hizo en el
 * periodo actual, no genera duplicados.
 */
require("dotenv").config();

const backup = require("../src/services/backup.service");
const db = require("../src/config/db");

async function main() {
  const configuracion = await backup.obtenerConfiguracion();

  if (!configuracion.automatico.activo) {
    console.log(
      "Las copias automáticas están desactivadas en backups/config.json.",
    );
    return;
  }

  const entrada = await backup.ejecutarBackupAutomatico();

  if (!entrada) {
    console.log("No toca ejecutar ninguna copia en este periodo.");
    return;
  }

  console.log(
    `Copia automática creada: ${entrada.nombre} (${entrada.tamano} bytes)`,
  );
  console.log(`Verificación: ${entrada.verificacion?.ok ? "OK" : "CON ERRORES"}`);
}

main()
  .catch((error) => {
    console.error("Error ejecutando la copia automática:", error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
