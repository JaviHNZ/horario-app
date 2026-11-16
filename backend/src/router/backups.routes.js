const express = require("express");

const backup = require("../services/backup.service");

const router = express.Router();

function responderError(res, error, mensajeGenerico) {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(`${mensajeGenerico}:`, error);
  }

  res.status(status).json({
    ok: false,
    error: error.message || mensajeGenerico,
  });
}

function cabecerasVerificacion(res, verificacion) {
  const resumen = {
    ok: Boolean(verificacion?.ok),
    comprobaciones: (verificacion?.comprobaciones || []).length,
    errores: verificacion?.errores || [],
  };

  res.setHeader(
    "X-Verificacion",
    encodeURIComponent(JSON.stringify(resumen)),
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Verificacion, Content-Disposition");
}

// ============================================
// HISTORIAL DE COPIAS
// ============================================

router.get("/", async (req, res) => {
  try {
    const copias = await backup.listarBackups();

    res.json({ ok: true, copias });
  } catch (error) {
    responderError(res, error, "Error listando las copias de seguridad");
  }
});

// ============================================
// CONFIGURACIÓN DE COPIAS AUTOMÁTICAS
// ============================================

router.get("/configuracion", async (req, res) => {
  try {
    const configuracion = await backup.obtenerConfiguracion();

    res.json({ ok: true, configuracion });
  } catch (error) {
    responderError(res, error, "Error obteniendo la configuración");
  }
});

router.put("/configuracion", async (req, res) => {
  try {
    const configuracion = await backup.guardarConfiguracion(req.body || {});

    res.json({ ok: true, configuracion });
  } catch (error) {
    responderError(res, error, "Error guardando la configuración");
  }
});

// ============================================
// EXPORTACIONES EXCEL
// ============================================

router.post("/exportar/clientes-casas", async (req, res) => {
  try {
    const exportacion = await backup.crearExcelClientesCasas();

    cabecerasVerificacion(res, exportacion.verificacion);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportacion.nombre}"`,
    );

    res.send(exportacion.buffer);
  } catch (error) {
    responderError(res, error, "Error exportando clientes y casas");
  }
});

router.post("/exportar/trabajadores", async (req, res) => {
  try {
    const exportacion = await backup.crearExcelTrabajadores();

    cabecerasVerificacion(res, exportacion.verificacion);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportacion.nombre}"`,
    );

    res.send(exportacion.buffer);
  } catch (error) {
    responderError(res, error, "Error exportando trabajadores");
  }
});

router.post("/exportar/servicios", async (req, res) => {
  try {
    const exportacion = await backup.crearExcelServicios();

    cabecerasVerificacion(res, exportacion.verificacion);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportacion.nombre}"`,
    );

    res.send(exportacion.buffer);
  } catch (error) {
    responderError(res, error, "Error exportando el historial de servicios");
  }
});

// ============================================
// SQL Y ZIP COMPLETO
// ============================================

router.post("/exportar/sql", async (req, res) => {
  try {
    const entrada = await backup.crearSqlBackup({ tipo: "sql" });
    const encontrada = await backup.obtenerBackup(entrada.nombre);

    if (!encontrada) {
      throw new Error("No se pudo leer el respaldo SQL generado");
    }

    cabecerasVerificacion(res, entrada.verificacion);
    res.setHeader("Content-Type", "application/sql");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="base_datos_completa.sql"',
    );

    res.sendFile(encontrada.ruta);
  } catch (error) {
    responderError(res, error, "Error generando el respaldo SQL");
  }
});

router.post("/exportar/completo", async (req, res) => {
  try {
    const entrada = await backup.crearBackupCompleto({ tipo: "completa" });
    const encontrada = await backup.obtenerBackup(entrada.nombre);

    if (!encontrada) {
      throw new Error("No se pudo leer el ZIP generado");
    }

    cabecerasVerificacion(res, entrada.verificacion);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${entrada.nombre}"`,
    );

    res.sendFile(encontrada.ruta);
  } catch (error) {
    responderError(res, error, "Error generando la copia completa");
  }
});

router.post("/automatico/ejecutar", async (req, res) => {
  try {
    const entrada = await backup.ejecutarBackupAutomatico({ forzar: true });

    if (!entrada) {
      return res.status(400).json({
        ok: false,
        error:
          "La copia automática no está activa. Actívala en la configuración o usa la copia completa manual.",
      });
    }

    res.json({ ok: true, copia: entrada });
  } catch (error) {
    responderError(res, error, "Error ejecutando la copia automática");
  }
});

// ============================================
// DESCARGAR / VERIFICAR / RESTAURAR
// ============================================

router.get("/:nombre/descargar", async (req, res) => {
  try {
    const encontrada = await backup.obtenerBackup(req.params.nombre);

    if (!encontrada) {
      return res.status(404).json({
        ok: false,
        error: "Copia de seguridad no encontrada",
      });
    }

    const esSql = encontrada.entrada.nombre.toLowerCase().endsWith(".sql");
    const nombreDescarga = esSql
      ? "base_datos_completa.sql"
      : encontrada.entrada.nombre;

    res.download(encontrada.ruta, nombreDescarga);
  } catch (error) {
    responderError(res, error, "Error descargando la copia de seguridad");
  }
});

router.post("/:nombre/verificar", async (req, res) => {
  try {
    const verificacion = await backup.verificarBackupGuardado(
      req.params.nombre,
    );

    res.json({ ok: true, verificacion });
  } catch (error) {
    responderError(res, error, "Error verificando la copia de seguridad");
  }
});

router.post("/:nombre/probar-restauracion", async (req, res) => {
  try {
    const resultado = await backup.probarRestauracionSql(req.params.nombre);

    res.json({ ok: resultado.ok, verificacion: resultado });
  } catch (error) {
    responderError(
      res,
      error,
      "Error probando la restauración en una base temporal",
    );
  }
});

router.post("/restaurar", async (req, res) => {
  try {
    const { nombre, confirmacion } = req.body || {};

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "Indica el nombre de la copia que quieres restaurar",
      });
    }

    const resultado = await backup.restaurarBackup(nombre, confirmacion);

    res.json(resultado);
  } catch (error) {
    responderError(res, error, "Error restaurando la copia de seguridad");
  }
});

// ============================================
// GOOGLE DRIVE
// ============================================

router.get("/google-drive/estado", async (req, res) => {
  try {
    const estado = await backup.estadoGoogleDrive();

    res.json({ ok: true, estado });
  } catch (error) {
    responderError(res, error, "Error consultando Google Drive");
  }
});

router.get("/google-drive/autorizar", async (req, res) => {
  try {
    const url = backup.urlAutorizacionGoogleDrive();

    res.json({ ok: true, url });
  } catch (error) {
    responderError(res, error, "Error iniciando la autorización de Google");
  }
});

router.get("/google-drive/callback", async (req, res) => {
  const frontend = process.env.FRONTEND_URL || "http://localhost:5175";

  try {
    const { code, state, error } = req.query;

    if (error) {
      throw new Error(`Google canceló la autorización: ${error}`);
    }

    if (!code || !state) {
      throw new Error("Faltan parámetros en la respuesta de Google");
    }

    await backup.procesarCallbackGoogleDrive(String(code), String(state));

    res.redirect(`${frontend}/copias?drive=ok`);
  } catch (error) {
    console.error("Error en el callback de Google Drive:", error.message);

    res.redirect(
      `${frontend}/copias?drive=error&mensaje=${encodeURIComponent(
        error.message,
      )}`,
    );
  }
});

router.post("/google-drive/subir", async (req, res) => {
  try {
    const { nombre } = req.body || {};

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "Indica el nombre de la copia que quieres subir",
      });
    }

    const resultado = await backup.subirBackupGoogleDrive(nombre);

    res.json(resultado);
  } catch (error) {
    responderError(res, error, "Error subiendo la copia a Google Drive");
  }
});

router.post("/google-drive/desconectar", async (req, res) => {
  try {
    await backup.desconectarGoogleDrive();

    res.json({ ok: true, mensaje: "Google Drive desconectado" });
  } catch (error) {
    responderError(res, error, "Error desconectando Google Drive");
  }
});

module.exports = router;
