const express = require("express");
const multer = require("multer");
const pool = require("../config/db");

const router = express.Router();

const { analizarHorario } = require("../services/gemini.service");

const upload = multer({
  dest: "uploads/",
});

function normalizarTrabajadoresHistorial(valor) {
  const trabajadores = typeof valor === "string" ? JSON.parse(valor) : valor;

  if (!Array.isArray(trabajadores)) {
    return [];
  }

  return trabajadores.filter((trabajador) => trabajador.id !== null);
}

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

    // -----------------------------------------
    // 1.1. Obtener casas y trabajadores activos desde MySQL
    // -----------------------------------------

    const [casasActivas] = await pool.query(
      `
      SELECT nombre
      FROM casas
      WHERE activo = TRUE
      ORDER BY nombre ASC
      `,
    );

    const [trabajadoresActivos] = await pool.query(
      `
      SELECT codigo
      FROM trabajadores
      WHERE activo = TRUE
      ORDER BY CHAR_LENGTH(codigo) DESC, codigo ASC
      `,
    );

    const casas = casasActivas.map((casa) => casa.nombre);
    const trabajadores = trabajadoresActivos.map(
      (trabajador) => trabajador.codigo,
    );

    if (casas.length === 0 || trabajadores.length === 0) {
      return res.status(400).json({
        ok: false,
        error:
          "No hay casas o trabajadores activos en la base de datos para analizar el horario",
      });
    }

    const resultadoGemini = await analizarHorario(
      req.file.path,
      req.file.mimetype,
      casas,
      trabajadores,
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

      if (
        servicio.observaciones &&
        String(servicio.observaciones).length > 1000
      ) {
        return res.status(400).json({
          ok: false,
          error: `Las observaciones de "${servicio.casa}" superan los 1000 caracteres`,
        });
      }
    }

    // ----------------------------------------
    // INICIAR TRANSACCIÓN
    // ----------------------------------------

    await connection.beginTransaction();

    // ----------------------------------------
    // NO REEMPLAZAR HORARIOS YA FACTURADOS
    // ----------------------------------------

    const [horariosFacturados] = await connection.query(
      `
      SELECT DISTINCT fd.factura_id, f.estado
      FROM factura_detalles fd
      INNER JOIN facturas f ON f.id = fd.factura_id
      INNER JOIN horarios h ON h.id = fd.horario_id
      INNER JOIN dias d ON d.id = h.dia_id
      WHERE d.fecha = ?
      `,
      [fecha],
    );

    if (horariosFacturados.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        ok: false,
        error:
          "No se puede reemplazar este día: algunas visitas ya están incluidas en una factura (borrador, emitida o pagada). Elimina el borrador o anula la factura antes de volver a guardar el horario.",
      });
    }

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
                        hora_fin,
                        observaciones
                    )
                    VALUES (?, ?, ?, ?, ?)
                    `,
        [
          diaId,
          servicio.casa_id,
          servicio.hora_inicio,
          servicio.hora_fin,
          servicio.observaciones || null,
        ],
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
// HISTORIAL
// ============================================

router.get("/historial", async (req, res) => {
  try {
    const [dias] = await pool.query(`
      SELECT
        d.id,
        d.fecha,
        d.nombre_archivo,
        d.imagen_path,
        d.estado,
        d.fecha_creacion,
        COUNT(h.id) AS total_servicios
      FROM dias d
      LEFT JOIN horarios h ON h.dia_id = d.id
      GROUP BY
        d.id,
        d.fecha,
        d.nombre_archivo,
        d.imagen_path,
        d.estado,
        d.fecha_creacion
      ORDER BY d.fecha DESC, d.id DESC
    `);

    res.json({
      ok: true,
      dias,
    });
  } catch (error) {
    console.error("Error obteniendo historial:", error);

    res.status(500).json({
      ok: false,
      error: "Error obteniendo historial",
    });
  }
});

router.get("/historial/:diaId", async (req, res) => {
  try {
    const { diaId } = req.params;

    const [dias] = await pool.query(
      `
      SELECT
        id,
        fecha,
        nombre_archivo,
        imagen_path,
        estado,
        fecha_creacion
      FROM dias
      WHERE id = ?
      `,
      [diaId],
    );

    if (dias.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Día no encontrado",
      });
    }

    const [servicios] = await pool.query(
      `
      SELECT
        h.id,
        h.hora_inicio,
        h.hora_fin,
        h.observaciones,
        h.duracion_facturable_minutos,
        c.id AS casa_id,
        c.nombre AS casa,
        c.direccion,
        c.duracion_minutos,
        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', t.id,
              'nombre', t.nombre,
              'codigo', t.codigo,
              'activo', t.activo
            )
          ),
          JSON_ARRAY()
        ) AS trabajadores
      FROM horarios h
      INNER JOIN casas c ON c.id = h.casa_id
      LEFT JOIN horario_trabajadores ht ON ht.horario_id = h.id
      LEFT JOIN trabajadores t ON t.id = ht.trabajador_id
      WHERE h.dia_id = ?
      GROUP BY
        h.id,
        h.hora_inicio,
        h.hora_fin,
        h.observaciones,
        h.duracion_facturable_minutos,
        c.id,
        c.nombre,
        c.direccion,
        c.duracion_minutos
      ORDER BY h.hora_inicio ASC, c.nombre ASC
      `,
      [diaId],
    );

    res.json({
      ok: true,
      dia: dias[0],
      servicios: servicios.map((servicio) => ({
        ...servicio,
        trabajadores: normalizarTrabajadoresHistorial(servicio.trabajadores),
      })),
    });
  } catch (error) {
    console.error("Error obteniendo detalle de historial:", error);

    res.status(500).json({
      ok: false,
      error: "Error obteniendo detalle de historial",
    });
  }
});
// DELETE /api/horarios/historial/:diaId
// Elimina el día completo. La FK de horarios -> dias es ON DELETE CASCADE y
// la de horario_trabajadores -> horarios también, así que desaparecen los
// servicios y sus asignaciones sin tocar casas ni trabajadores.
router.delete("/historial/:diaId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { diaId } = req.params;

    await connection.beginTransaction();

    const [dias] = await connection.query(
      `
      SELECT id, fecha
      FROM dias
      WHERE id = ?
      `,
      [diaId],
    );

    if (dias.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        ok: false,
        error: "Día no encontrado",
      });
    }

    // Si alguna visita está en una factura, la FK RESTRICT impediría el
    // borrado. Se comprueba antes para devolver un mensaje claro.
    const [facturados] = await connection.query(
      `
      SELECT DISTINCT f.id, f.estado
      FROM factura_detalles fd
      INNER JOIN facturas f ON f.id = fd.factura_id
      INNER JOIN horarios h ON h.id = fd.horario_id
      WHERE h.dia_id = ?
      `,
      [diaId],
    );

    if (facturados.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        ok: false,
        error:
          "No se puede eliminar este día: algunas visitas están incluidas en una factura. Elimina el borrador o anula la factura antes de borrar el día.",
      });
    }

    const [servicios] = await connection.query(
      `
      SELECT COUNT(*) AS total
      FROM horarios
      WHERE dia_id = ?
      `,
      [diaId],
    );

    await connection.query(
      `
      DELETE FROM dias
      WHERE id = ?
      `,
      [diaId],
    );

    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Día eliminado correctamente",
      dia_id: Number(diaId),
      fecha: dias[0].fecha,
      servicios_eliminados: Number(servicios[0].total),
    });
  } catch (error) {
    await connection.rollback();

    console.error("Error eliminando día del historial:", error);

    res.status(500).json({
      ok: false,
      error: "Error eliminando el día del historial",
    });
  } finally {
    connection.release();
  }
});

// PUT /api/horarios/historial/:diaId
// Edita un día completo de forma transaccional. Los servicios con `id`
// existente se actualizan en su sitio (se conserva el id y no se duplican);
// los servicios sin id se insertan y los que ya no vienen se eliminan.
// Cada servicio puede llevar su propia `fecha` para moverlo a otro día.
router.put("/historial/:diaId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { diaId } = req.params;
    const { fecha, servicios } = req.body;

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

    for (const servicio of servicios) {
      if (!servicio.casa_id) {
        return res.status(400).json({
          ok: false,
          error: `La casa de "${servicio.casa || "un servicio"}" no está seleccionada`,
        });
      }

      if (!servicio.hora_inicio || !servicio.hora_fin) {
        return res.status(400).json({
          ok: false,
          error: `Falta la hora de "${servicio.casa || "un servicio"}"`,
        });
      }

      if (
        !Array.isArray(servicio.trabajadores) ||
        servicio.trabajadores.length === 0
      ) {
        return res.status(400).json({
          ok: false,
          error: `No hay trabajadores en "${servicio.casa || "un servicio"}"`,
        });
      }

      if (
        servicio.observaciones &&
        String(servicio.observaciones).length > 1000
      ) {
        return res.status(400).json({
          ok: false,
          error: "Las observaciones de un servicio superan los 1000 caracteres",
        });
      }
    }

    await connection.beginTransaction();

    const [diasOrigen] = await connection.query(
      `
      SELECT id, fecha
      FROM dias
      WHERE id = ?
      FOR UPDATE
      `,
      [diaId],
    );

    if (diasOrigen.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        ok: false,
        error: "Día no encontrado",
      });
    }

    const [horariosOriginales] = await connection.query(
      `
      SELECT id
      FROM horarios
      WHERE dia_id = ?
      FOR UPDATE
      `,
      [diaId],
    );

    const idsOriginales = new Set(
      horariosOriginales.map((horario) => Number(horario.id)),
    );

    // Si alguna visita está facturada no se puede editar: el detalle de la
    // factura guarda una copia de fecha, horas e importe.
    const [facturados] = await connection.query(
      `
      SELECT DISTINCT f.id
      FROM factura_detalles fd
      INNER JOIN facturas f ON f.id = fd.factura_id
      INNER JOIN horarios h ON h.id = fd.horario_id
      WHERE h.dia_id = ?
      `,
      [diaId],
    );

    if (facturados.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        ok: false,
        error:
          "No se puede editar este día: algunas visitas están incluidas en una factura. Anula la factura antes de modificarlo.",
      });
    }

    // ----------------------------------------
    // DÍAS DESTINO (la fecha del día o la de cada servicio)
    // ----------------------------------------

    const fechasDestino = [
      ...new Set(servicios.map((servicio) => servicio.fecha || fecha)),
    ];

    const diasPorFecha = new Map();
    const fechaOrigen = String(diasOrigen[0].fecha).slice(0, 10);
    const fechaUnica = fechasDestino.length === 1 ? fechasDestino[0] : null;

    if (fechaUnica && fechaUnica !== fechaOrigen) {
      const [otroDia] = await connection.query(
        `
        SELECT id
        FROM dias
        WHERE fecha = ?
        FOR UPDATE
        `,
        [fechaUnica],
      );

      if (otroDia.length === 0) {
        // Cambio de fecha del día completo: se conserva el mismo registro
        // de `dias` (id, archivo original y fecha de creación).
        await connection.query(
          `
          UPDATE dias
          SET fecha = ?
          WHERE id = ?
          `,
          [fechaUnica, diaId],
        );

        diasPorFecha.set(fechaUnica, Number(diaId));
      } else {
        // Ya existe un día con esa fecha: se fusionan los servicios.
        diasPorFecha.set(fechaUnica, Number(otroDia[0].id));
      }
    } else {
      for (const fechaDestino of fechasDestino) {
        const [existentes] = await connection.query(
          `
          SELECT id
          FROM dias
          WHERE fecha = ?
          FOR UPDATE
          `,
          [fechaDestino],
        );

        if (existentes.length > 0) {
          diasPorFecha.set(fechaDestino, Number(existentes[0].id));
        } else {
          const [insertado] = await connection.query(
            `
            INSERT INTO dias (fecha, estado)
            VALUES (?, 'confirmado')
            `,
            [fechaDestino],
          );

          diasPorFecha.set(fechaDestino, insertado.insertId);
        }
      }
    }

    const idsConservados = new Set();

    for (const servicio of servicios) {
      const fechaServicio = servicio.fecha || fecha;
      const destinoDiaId = diasPorFecha.get(fechaServicio);
      const esOriginal =
        servicio.id && idsOriginales.has(Number(servicio.id));

      let horarioId;

      if (esOriginal) {
        horarioId = Number(servicio.id);
        idsConservados.add(horarioId);

        await connection.query(
          `
          UPDATE horarios
          SET
            dia_id = ?,
            casa_id = ?,
            hora_inicio = ?,
            hora_fin = ?,
            observaciones = ?
          WHERE id = ?
          `,
          [
            destinoDiaId,
            servicio.casa_id,
            servicio.hora_inicio,
            servicio.hora_fin,
            servicio.observaciones || null,
            horarioId,
          ],
        );

        await connection.query(
          `
          DELETE FROM horario_trabajadores
          WHERE horario_id = ?
          `,
          [horarioId],
        );
      } else {
        const [insertado] = await connection.query(
          `
          INSERT INTO horarios
          (
            dia_id,
            casa_id,
            hora_inicio,
            hora_fin,
            observaciones
          )
          VALUES (?, ?, ?, ?, ?)
          `,
          [
            destinoDiaId,
            servicio.casa_id,
            servicio.hora_inicio,
            servicio.hora_fin,
            servicio.observaciones || null,
          ],
        );

        horarioId = insertado.insertId;
        idsConservados.add(horarioId);
      }

      const trabajadores = [
        ...new Set(
          servicio.trabajadores
            .map((trabajadorId) => Number(trabajadorId))
            .filter(Boolean),
        ),
      ];

      for (const trabajadorId of trabajadores) {
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

    // Servicios del día original que ya no vienen en la edición.
    const idsEliminados = [...idsOriginales].filter(
      (id) => !idsConservados.has(id),
    );

    if (idsEliminados.length > 0) {
      await connection.query(
        `
        DELETE FROM horarios
        WHERE id IN (?)
        `,
        [idsEliminados],
      );
    }

    // Si el día original se ha quedado vacío y no es destino, se elimina.
    const origenSigueSiendoDestino = fechasDestino.some(
      (fechaDestino) => diasPorFecha.get(fechaDestino) === Number(diaId),
    );

    let diaOrigenEliminado = false;

    if (!origenSigueSiendoDestino) {
      const [restantes] = await connection.query(
        `
        SELECT COUNT(*) AS total
        FROM horarios
        WHERE dia_id = ?
        `,
        [diaId],
      );

      if (Number(restantes[0].total) === 0) {
        await connection.query(
          `
          DELETE FROM dias
          WHERE id = ?
          `,
          [diaId],
        );

        diaOrigenEliminado = true;
      }
    }

    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Día actualizado correctamente",
      dia_id: Number(diaId),
      dia_origen_eliminado: diaOrigenEliminado,
      fechas: fechasDestino,
      servicios_guardados: servicios.length,
      servicios_eliminados: idsEliminados.length,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Error editando día del historial:", error);

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({
        ok: false,
        error:
          "La casa o alguno de los trabajadores ya no existe. Recarga los datos y vuelve a intentarlo.",
      });
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error:
          "Ya existe otro día con esa fecha. Vuelve a cargar el historial para verlo.",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error editando el día del historial",
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
// PATCH /api/horarios/:id/duracion-facturable
router.patch("/:id/duracion-facturable", async (req, res) => {
  try {
    const { id } = req.params;
    const { duracion_facturable_minutos } = req.body;

    let valor = null;

    if (
      duracion_facturable_minutos !== null &&
      duracion_facturable_minutos !== undefined &&
      duracion_facturable_minutos !== ""
    ) {
      const numero = Number(duracion_facturable_minutos);

      if (!Number.isInteger(numero) || numero <= 0) {
        return res.status(400).json({
          ok: false,
          error: "La duración facturable debe ser un número entero mayor que cero",
        });
      }

      valor = numero;
    }

    const [resultado] = await pool.query(
      `
      UPDATE horarios
      SET duracion_facturable_minutos = ?
      WHERE id = ?
      `,
      [valor, id],
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        error: "Visita no encontrada",
      });
    }

    res.json({
      ok: true,
      mensaje: "Duración facturable actualizada",
    });
  } catch (error) {
    console.error("Error actualizando duración facturable:", error);
    res.status(500).json({
      ok: false,
      error: "Error actualizando duración facturable",
    });
  }
});

module.exports = router;
