const express = require("express");
const multer = require("multer");
const db = require("../config/db");

const router = express.Router();

const { analizarHorario } = require("../services/gemini.service");

const upload = multer({
  dest: "uploads/",
});

router.post("/analizar", upload.single("imagen"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No se ha enviado ninguna imagen",
      });
    }

    console.log("Imagen recibida:", req.file.originalname);

    // -----------------------------------------
    // 1. Analizar imagen con Gemini
    // -----------------------------------------

    const resultadoGemini = await analizarHorario(
      req.file.path,
      req.file.mimetype,
    );

    // -----------------------------------------
    // 2. Validar resultado contra MySQL
    // -----------------------------------------

    const servicios = resultadoGemini.servicios;

    if (!Array.isArray(servicios)) {
      return res.status(500).json({
        ok: false,
        error: "Gemini no devolvió un formato válido",
      });
    }

    const serviciosValidados = [];

    for (const servicio of servicios) {
      // -------------------------------------
      // Buscar casa
      // -------------------------------------

      const [casas] = await db.query(
        `
                SELECT
                    id,
                    nombre,
                    duracion_minutos,
                    activo
                FROM casas
                WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))
                `,
        [servicio.casa],
      );

      const casaEncontrada = casas.length > 0 ? casas[0] : null;

      // -------------------------------------
      // Buscar trabajadores
      // -------------------------------------

      const trabajadoresValidados = [];

      for (const codigo of servicio.trabajadores) {
        const [trabajadores] = await db.query(
          `
                    SELECT
                        id,
                        nombre,
                        codigo,
                        activo
                    FROM trabajadores
                    WHERE UPPER(TRIM(codigo)) = UPPER(TRIM(?))
                    `,
          [codigo],
        );

        if (trabajadores.length > 0) {
          trabajadoresValidados.push({
            encontrado: true,
            trabajador: trabajadores[0],
          });
        } else {
          trabajadoresValidados.push({
            encontrado: false,
            codigo: codigo,
          });
        }
      }

      // -------------------------------------
      // Resultado
      // -------------------------------------

      serviciosValidados.push({
        casa: {
          nombre: servicio.casa,
          encontrada: casaEncontrada !== null,
          datos: casaEncontrada,
        },

        hora_inicio: servicio.hora_inicio,
        hora_fin: servicio.hora_fin,

        trabajadores: trabajadoresValidados,
      });
    }

    // -----------------------------------------
    // 3. Respuesta final
    // -----------------------------------------

    res.json({
      ok: true,

      imagen: {
        nombre_original: req.file.originalname,
      },

      servicios: serviciosValidados,
    });
  } catch (error) {
    console.error("Error analizando horario:", error);

    res.status(500).json({
      ok: false,
      error: "Error analizando el horario",
    });
  }
});

router.post("/guardar", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { fecha, casa_id, hora_inicio, hora_fin, trabajadores } = req.body;

    if (
      !fecha ||
      !casa_id ||
      !hora_inicio ||
      !hora_fin ||
      !Array.isArray(trabajadores)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios",
      });
    }

    await connection.beginTransaction();

    // -----------------------------------------
    // 1. Buscar si ya existe el día
    // -----------------------------------------

    const [dias] = await connection.query(
      `
            SELECT id
            FROM dias
            WHERE fecha = ?
            `,
      [fecha],
    );

    let diaId;

    if (dias.length > 0) {
      diaId = dias[0].id;
    } else {
      const [nuevoDia] = await connection.query(
        `
                INSERT INTO dias (fecha)
                VALUES (?)
                `,
        [fecha],
      );

      diaId = nuevoDia.insertId;
    }

    // -----------------------------------------
    // 2. Crear el horario
    // -----------------------------------------

    const [nuevoHorario] = await connection.query(
      `
            INSERT INTO horarios (
                dia_id,
                casa_id,
                hora_inicio,
                hora_fin
            )
            VALUES (?, ?, ?, ?)
            `,
      [diaId, casa_id, hora_inicio, hora_fin],
    );

    const horarioId = nuevoHorario.insertId;

    // -----------------------------------------
    // 3. Asignar trabajadores
    // -----------------------------------------

    for (const codigo of trabajadores) {
      const [resultadoTrabajador] = await connection.query(
        `
        SELECT id
        FROM trabajadores
        WHERE codigo = ?
          AND activo = TRUE
        `,
        [codigo.trim().toUpperCase()],
      );

      if (resultadoTrabajador.length === 0) {
        throw new Error(`Trabajador con código "${codigo}" no encontrado`);
      }

      const trabajadorId = resultadoTrabajador[0].id;

      await connection.query(
        `
        INSERT INTO horario_trabajadores (
            horario_id,
            trabajador_id
        )
        VALUES (?, ?)
        `,
        [horarioId, trabajadorId],
      );
    }

    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: "Horario guardado correctamente",
      horario_id: horarioId,
      dia_id: diaId,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Error guardando horario:", error);

    res.status(500).json({
      ok: false,
      error: "Error guardando horario",
    });
  } finally {
    connection.release();
  }
});
// POST /api/horarios/validar
router.post("/validar", async (req, res) => {
  try {
    const { servicios } = req.body;

    if (!Array.isArray(servicios)) {
      return res.status(400).json({
        ok: false,
        error: "El campo servicios debe ser un array",
      });
    }

    const resultado = [];

    for (const servicio of servicios) {
      // -----------------------------------------
      // Buscar casa
      // -----------------------------------------

      const [casas] = await db.query(
        `
                SELECT id, nombre, duracion_minutos, activo
                FROM casas
                WHERE LOWER(nombre) = LOWER(?)
                `,
        [servicio.casa.trim()],
      );

      const casaEncontrada = casas.length > 0 ? casas[0] : null;

      // -----------------------------------------
      // Buscar trabajadores
      // -----------------------------------------

      const trabajadoresResultado = [];

      for (const codigo of servicio.trabajadores) {
        const [trabajadores] = await db.query(
          `
                    SELECT id, nombre, codigo, activo
                    FROM trabajadores
                    WHERE UPPER(codigo) = UPPER(?)
                    `,
          [codigo.trim()],
        );

        if (trabajadores.length > 0) {
          trabajadoresResultado.push({
            encontrado: true,
            trabajador: trabajadores[0],
          });
        } else {
          trabajadoresResultado.push({
            encontrado: false,
            codigo: codigo,
          });
        }
      }

      // -----------------------------------------
      // Resultado del servicio
      // -----------------------------------------

      resultado.push({
        casa: {
          nombre: servicio.casa,
          encontrada: casaEncontrada !== null,
          datos: casaEncontrada,
        },

        hora_inicio: servicio.hora_inicio,
        hora_fin: servicio.hora_fin,

        trabajadores: trabajadoresResultado,
      });
    }

    res.json({
      ok: true,
      servicios: resultado,
    });
  } catch (error) {
    console.error("Error validando horario:", error);

    res.status(500).json({
      ok: false,
      error: "Error validando horario",
    });
  }
});
module.exports = router;
