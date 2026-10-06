const express = require("express");
const multer = require("multer");
const pool = require("../config/db");

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

      const [casas] = await pool.query(
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
        const [trabajadores] = await pool.query(
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
  const connection = await pool.getConnection();

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

      const [casas] = await pool.query(
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
        const [trabajadores] = await pool.query(
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
// ============================================
// GUARDAR HORARIO COMPLETO
// ============================================

router.post("/guardar-completo", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { fecha, imagen_original, servicios } = req.body;

    // ----------------------------------------
    // VALIDACIONES
    // ----------------------------------------

    if (!fecha) {
      return res.status(400).json({
        ok: false,
        error: "La fecha es obligatoria",
      });
    }

    if (!Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No hay servicios para guardar",
      });
    }

    // ----------------------------------------
    // COMPROBAR QUE TODO ESTÉ VALIDADO
    // ----------------------------------------

    for (const servicio of servicios) {
      if (!servicio.casa_id) {
        return res.status(400).json({
          ok: false,
          error: `La casa de "${servicio.casa}" no está seleccionada`,
        });
      }

      if (!servicio.hora_inicio || !servicio.hora_fin) {
        return res.status(400).json({
          ok: false,
          error: `Falta la hora de "${servicio.casa}"`,
        });
      }

      if (
        !Array.isArray(servicio.trabajadores) ||
        servicio.trabajadores.length === 0
      ) {
        return res.status(400).json({
          ok: false,
          error: `No hay trabajadores en "${servicio.casa}"`,
        });
      }
    }

    // ----------------------------------------
    // INICIAR TRANSACCIÓN
    // ----------------------------------------

    await connection.beginTransaction();

    // ----------------------------------------
    // CREAR / OBTENER EL DÍA
    // ----------------------------------------

    const [diasExistentes] = await connection.query(
      `
            SELECT id
            FROM dias
            WHERE fecha = ?
            `,
      [fecha],
    );

    let diaId;

    if (diasExistentes.length > 0) {
      diaId = diasExistentes[0].id;

      // Si ya existe ese día, eliminamos
      // sus horarios anteriores para
      // reemplazarlos por los nuevos.

      await connection.query(
        `
                DELETE FROM horarios
                WHERE dia_id = ?
                `,
        [diaId],
      );

      await connection.query(
        `
                UPDATE dias
                SET
                    nombre_archivo = ?,
                    estado = 'confirmado'
                WHERE id = ?
                `,
        [imagen_original || null, diaId],
      );
    } else {
      const [resultadoDia] = await connection.query(
        `
                    INSERT INTO dias
                    (
                        fecha,
                        nombre_archivo,
                        estado
                    )
                    VALUES (?, ?, 'confirmado')
                    `,
        [fecha, imagen_original || null],
      );

      diaId = resultadoDia.insertId;
    }

    // ----------------------------------------
    // GUARDAR CADA SERVICIO
    // ----------------------------------------

    for (const servicio of servicios) {
      const [resultadoHorario] = await connection.query(
        `
                    INSERT INTO horarios
                    (
                        dia_id,
                        casa_id,
                        hora_inicio,
                        hora_fin
                    )
                    VALUES (?, ?, ?, ?)
                    `,
        [diaId, servicio.casa_id, servicio.hora_inicio, servicio.hora_fin],
      );

      const horarioId = resultadoHorario.insertId;

      // ------------------------------------
      // TRABAJADORES DEL SERVICIO
      // ------------------------------------

      for (const trabajadorId of servicio.trabajadores) {
        await connection.query(
          `
                    INSERT INTO horario_trabajadores
                    (
                        horario_id,
                        trabajador_id
                    )
                    VALUES (?, ?)
                    `,
          [horarioId, trabajadorId],
        );
      }
    }

    // ----------------------------------------
    // CONFIRMAR TODO
    // ----------------------------------------

    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Horario completo guardado correctamente",
      dia_id: diaId,
      servicios_guardados: servicios.length,
    });
  } catch (error) {
    // ----------------------------------------
    // DESHACER TODO SI HAY ERROR
    // ----------------------------------------

    await connection.rollback();

    console.error("Error guardando horario completo:", error);

    res.status(500).json({
      ok: false,
      error: "Error guardando el horario completo",
    });
  } finally {
    connection.release();
  }
});
// ============================================
// CASAS
// ============================================

// Obtener todas las casas activas
router.get("/casas", async (req, res) => {
  try {
    const [casas] = await pool.query(`
      SELECT
        id,
        nombre,
        direccion,
        duracion_minutos,
        activo
      FROM casas
      WHERE activo = TRUE
      ORDER BY nombre ASC
    `);

    res.json({
      ok: true,
      casas,
    });
  } catch (error) {
    console.error("Error obteniendo casas:", error);

    res.status(500).json({
      ok: false,
      error: "Error obteniendo casas",
    });
  }
});

// Crear una casa
router.post("/casas", async (req, res) => {
  try {
    const { nombre, direccion, duracion_minutos } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        error: "El nombre de la casa es obligatorio",
      });
    }

    const [resultado] = await pool.query(
      `
      INSERT INTO casas (
        nombre,
        direccion,
        duracion_minutos
      )
      VALUES (?, ?, ?)
      `,
      [nombre.trim(), direccion?.trim() || null, duracion_minutos || null],
    );

    res.status(201).json({
      ok: true,
      mensaje: "Casa creada correctamente",
      casa_id: resultado.insertId,
    });
  } catch (error) {
    console.error("Error creando casa:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe una casa con ese nombre",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error creando casa",
    });
  }
});

// ============================================
// TRABAJADORES
// ============================================

// Obtener todos los trabajadores activos
router.get("/trabajadores", async (req, res) => {
  try {
    const [trabajadores] = await pool.query(`
      SELECT
        id,
        nombre,
        codigo,
        activo
      FROM trabajadores
      WHERE activo = TRUE
      ORDER BY nombre ASC
    `);

    res.json({
      ok: true,
      trabajadores,
    });
  } catch (error) {
    console.error("Error obteniendo trabajadores:", error);

    res.status(500).json({
      ok: false,
      error: "Error obteniendo trabajadores",
    });
  }
});

// Crear un trabajador
router.post("/trabajadores", async (req, res) => {
  try {
    const { nombre, codigo } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        error: "El nombre del trabajador es obligatorio",
      });
    }

    if (!codigo || !codigo.trim()) {
      return res.status(400).json({
        ok: false,
        error: "El código del trabajador es obligatorio",
      });
    }

    const codigoNormalizado = codigo.trim().toUpperCase();

    const [resultado] = await pool.query(
      `
      INSERT INTO trabajadores (
        nombre,
        codigo
      )
      VALUES (?, ?)
      `,
      [nombre.trim(), codigoNormalizado],
    );

    res.status(201).json({
      ok: true,
      mensaje: "Trabajador creado correctamente",
      trabajador_id: resultado.insertId,
    });
  } catch (error) {
    console.error("Error creando trabajador:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un trabajador con ese código",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error creando trabajador",
    });
  }
});
module.exports = router;
