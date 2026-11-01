const express = require("express");
const db = require("../config/db");
const PDFDocument = require("pdfkit");

const router = express.Router();

function calcularMinutos(inicio, fin) {
  const [h1, m1] = String(inicio).slice(0, 5).split(":").map(Number);
  const [h2, m2] = String(fin).slice(0, 5).split(":").map(Number);
  let minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (minutos < 0) {
    minutos += 1440;
  }
  return minutos;
}

function redondear2(valor) {
  return Math.round(valor * 100) / 100;
}

function calcularImporte(minutos, precioPorHora) {
  return redondear2((minutos * Number(precioPorHora)) / 60);
}

// GET /api/facturas?casa_id=&estado=
router.get("/", async (req, res) => {
  try {
    const { casa_id, estado } = req.query;

    let where = "1 = 1";
    const params = [];

    if (casa_id) {
      where += " AND f.casa_id = ?";
      params.push(casa_id);
    }

    if (estado) {
      where += " AND f.estado = ?";
      params.push(estado);
    }

    const [facturas] = await db.query(
      `
      SELECT
        f.*,
        c.nombre AS casa_nombre
      FROM facturas f
      INNER JOIN casas c ON c.id = f.casa_id
      WHERE ${where}
      ORDER BY f.fecha_creacion DESC, f.id DESC
      `,
      params,
    );

    res.json({
      ok: true,
      facturas,
    });
  } catch (error) {
    console.error("Error listando facturas:", error);
    res.status(500).json({
      ok: false,
      error: "Error listando facturas",
    });
  }
});

// GET /api/facturas/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [facturas] = await db.query(
      `
      SELECT f.*, c.nombre AS casa_nombre
      FROM facturas f
      INNER JOIN casas c ON c.id = f.casa_id
      WHERE f.id = ?
      `,
      [id],
    );

    if (facturas.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    const [detalles] = await db.query(
      `
      SELECT *
      FROM factura_detalles
      WHERE factura_id = ?
      ORDER BY fecha_servicio ASC, id ASC
      `,
      [id],
    );

    res.json({
      ok: true,
      factura: facturas[0],
      detalles,
    });
  } catch (error) {
    console.error("Error obteniendo factura:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo factura",
    });
  }
});

// POST /api/facturas/borrador
router.post("/borrador", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      casa_id,
      fecha_inicio_periodo,
      fecha_fin_periodo,
      precio_por_hora,
      porcentaje_impuesto = 0,
      observaciones = null,
      nombre_emisor = null,
      identificacion_emisor = null,
      direccion_emisor = null,
      nombre_cliente,
      direccion_cliente = null,
      numero_factura = null,
      horario_ids,
    } = req.body;

    if (!casa_id || !fecha_inicio_periodo || !fecha_fin_periodo) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios del período",
      });
    }

    if (!nombre_cliente || !String(nombre_cliente).trim()) {
      return res.status(400).json({
        ok: false,
        error: "El nombre del cliente es obligatorio",
      });
    }

    const precio = Number(precio_por_hora);
    if (Number.isNaN(precio) || precio < 0) {
      return res.status(400).json({
        ok: false,
        error: "El precio por hora no es válido",
      });
    }

    const impuesto = Number(porcentaje_impuesto);
    if (Number.isNaN(impuesto) || impuesto < 0) {
      return res.status(400).json({
        ok: false,
        error: "El porcentaje de impuesto no es válido",
      });
    }

    await connection.beginTransaction();

    const [casas] = await connection.query(
      "SELECT id, nombre FROM casas WHERE id = ?",
      [casa_id],
    );

    if (casas.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        ok: false,
        error: "Casa no encontrada",
      });
    }

    const casa = casas[0];

    const [visitas] = await connection.query(
      `
      SELECT
        h.id,
        d.fecha,
        h.hora_inicio,
        h.hora_fin,
        h.duracion_facturable_minutos,
        c.duracion_minutos AS duracion_habitual_minutos
      FROM horarios h
      INNER JOIN dias d ON d.id = h.dia_id
      INNER JOIN casas c ON c.id = h.casa_id
      WHERE h.casa_id = ?
        AND d.fecha BETWEEN ? AND ?
      ORDER BY d.fecha ASC, h.hora_inicio ASC
      `,
      [casa_id, fecha_inicio_periodo, fecha_fin_periodo],
    );

    const horariosSolicitados = Array.isArray(horario_ids)
      ? horario_ids.map(Number)
      : null;

    if (horariosSolicitados && horariosSolicitados.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "No has seleccionado ninguna visita para facturar",
      });
    }

    const seleccionadas = visitas.filter((visita) =>
      horariosSolicitados
        ? horariosSolicitados.includes(Number(visita.id))
        : true,
    );

    if (seleccionadas.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "No hay visitas seleccionadas en el período indicado",
      });
    }

    // Evitar duplicar visitas ya facturadas en facturas emitidas/pagadas
    const idsSeleccionados = seleccionadas.map((v) => v.id);
    const [yaFacturadas] = await connection.query(
      `
      SELECT DISTINCT fd.horario_id
      FROM factura_detalles fd
      INNER JOIN facturas f ON f.id = fd.factura_id
      WHERE fd.horario_id IN (?)
        AND f.estado IN ('emitida', 'pagada')
      `,
      [idsSeleccionados],
    );

    if (yaFacturadas.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        ok: false,
        error: "Alguna de las visitas seleccionadas ya está incluida en una factura emitida",
      });
    }

    const detallesCalculados = seleccionadas.map((visita) => {
      const duracion =
        visita.duracion_facturable_minutos != null
          ? visita.duracion_facturable_minutos
          : visita.duracion_habitual_minutos;

      const importe = duracion != null ? calcularImporte(duracion, precio) : 0;

      return {
        horario_id: visita.id,
        fecha_servicio: visita.fecha,
        nombre_casa: casa.nombre,
        descripcion: `Servicio de limpieza - ${casa.nombre}`,
        hora_inicio: visita.hora_inicio,
        hora_fin: visita.hora_fin,
        duracion_facturable_minutos: duracion != null ? duracion : 0,
        precio_por_hora: precio,
        importe,
        pendiente: duracion == null,
      };
    });

    const totalMinutos = detallesCalculados.reduce(
      (acumulado, detalle) => acumulado + detalle.duracion_facturable_minutos,
      0,
    );

    const baseImponible = redondear2(
      detallesCalculados.reduce((acumulado, detalle) => acumulado + detalle.importe, 0),
    );

    const importeImpuesto = redondear2((baseImponible * impuesto) / 100);
    const total = redondear2(baseImponible + importeImpuesto);

    const [resultadoFactura] = await connection.query(
      `
      INSERT INTO facturas (
        numero_factura,
        casa_id,
        fecha_inicio_periodo,
        fecha_fin_periodo,
        nombre_cliente,
        direccion_cliente,
        nombre_emisor,
        identificacion_emisor,
        direccion_emisor,
        horas_totales_minutos,
        precio_por_hora,
        base_imponible,
        porcentaje_impuesto,
        importe_impuesto,
        total,
        estado,
        observaciones
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)
      `,
      [
        numero_factura,
        casa_id,
        fecha_inicio_periodo,
        fecha_fin_periodo,
        String(nombre_cliente).trim(),
        direccion_cliente,
        nombre_emisor,
        identificacion_emisor,
        direccion_emisor,
        totalMinutos,
        precio,
        baseImponible,
        impuesto,
        importeImpuesto,
        total,
        observaciones,
      ],
    );

    const facturaId = resultadoFactura.insertId;

    for (const detalle of detallesCalculados) {
      await connection.query(
        `
        INSERT INTO factura_detalles (
          factura_id,
          horario_id,
          fecha_servicio,
          nombre_casa,
          descripcion,
          hora_inicio,
          hora_fin,
          duracion_facturable_minutos,
          precio_por_hora,
          importe
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          facturaId,
          detalle.horario_id,
          detalle.fecha_servicio,
          detalle.nombre_casa,
          detalle.descripcion,
          detalle.hora_inicio,
          detalle.hora_fin,
          detalle.duracion_facturable_minutos,
          detalle.precio_por_hora,
          detalle.importe,
        ],
      );
    }

    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: "Borrador creado correctamente",
      factura_id: facturaId,
      pendiente_revision: detallesCalculados.some((detalle) => detalle.pendiente),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error creando borrador:", error);
    res.status(500).json({
      ok: false,
      error: "Error creando borrador de factura",
    });
  } finally {
    connection.release();
  }
});

// PUT /api/facturas/:id (solo borrador)
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [facturas] = await connection.query(
      "SELECT * FROM facturas WHERE id = ? FOR UPDATE",
      [id],
    );

    if (facturas.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    if (facturas[0].estado !== "borrador") {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "Solo se pueden editar facturas en borrador",
      });
    }

    const {
      fecha_inicio_periodo,
      fecha_fin_periodo,
      precio_por_hora,
      porcentaje_impuesto,
      observaciones,
      nombre_emisor,
      identificacion_emisor,
      direccion_emisor,
      nombre_cliente,
      direccion_cliente,
      numero_factura,
      horario_ids,
    } = req.body;

    if (
      precio_por_hora !== undefined &&
      (Number.isNaN(Number(precio_por_hora)) || Number(precio_por_hora) < 0)
    ) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "El precio por hora no es válido",
      });
    }

    if (
      porcentaje_impuesto !== undefined &&
      (Number.isNaN(Number(porcentaje_impuesto)) ||
        Number(porcentaje_impuesto) < 0)
    ) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "El porcentaje de impuesto no es válido",
      });
    }

    if (Array.isArray(horario_ids) && horario_ids.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "El borrador debe incluir al menos una visita",
      });
    }

    const campos = [];
    const valores = [];

    if (fecha_inicio_periodo) {
      campos.push("fecha_inicio_periodo = ?");
      valores.push(fecha_inicio_periodo);
    }

    if (fecha_fin_periodo) {
      campos.push("fecha_fin_periodo = ?");
      valores.push(fecha_fin_periodo);
    }

    if (precio_por_hora !== undefined) {
      campos.push("precio_por_hora = ?");
      valores.push(Number(precio_por_hora));
    }

    if (porcentaje_impuesto !== undefined) {
      campos.push("porcentaje_impuesto = ?");
      valores.push(Number(porcentaje_impuesto));
    }

    if (observaciones !== undefined) {
      campos.push("observaciones = ?");
      valores.push(observaciones);
    }

    if (nombre_emisor !== undefined) {
      campos.push("nombre_emisor = ?");
      valores.push(nombre_emisor);
    }

    if (identificacion_emisor !== undefined) {
      campos.push("identificacion_emisor = ?");
      valores.push(identificacion_emisor);
    }

    if (direccion_emisor !== undefined) {
      campos.push("direccion_emisor = ?");
      valores.push(direccion_emisor);
    }

    if (nombre_cliente !== undefined) {
      campos.push("nombre_cliente = ?");
      valores.push(String(nombre_cliente).trim());
    }

    if (direccion_cliente !== undefined) {
      campos.push("direccion_cliente = ?");
      valores.push(direccion_cliente);
    }

    if (numero_factura !== undefined) {
      campos.push("numero_factura = ?");
      valores.push(numero_factura);
    }

    if (campos.length > 0) {
      valores.push(id);
      await connection.query(
        `UPDATE facturas SET ${campos.join(", ")} WHERE id = ?`,
        valores,
      );
    }

    // Si se envían horario_ids, reconstruir detalles
    if (Array.isArray(horario_ids)) {
      const facturaActualizada = (await connection.query("SELECT * FROM facturas WHERE id = ?", [id]))[0][0];

      const [visitas] = await connection.query(
        `
        SELECT h.id, d.fecha, h.hora_inicio, h.hora_fin, h.duracion_facturable_minutos, c.duracion_minutos AS duracion_habitual_minutos, c.nombre AS nombre_casa
        FROM horarios h
        INNER JOIN dias d ON d.id = h.dia_id
        INNER JOIN casas c ON c.id = h.casa_id
        WHERE h.casa_id = ? AND d.fecha BETWEEN ? AND ?
        `,
        [facturaActualizada.casa_id, facturaActualizada.fecha_inicio_periodo, facturaActualizada.fecha_fin_periodo],
      );

      const idsSolicitados = horario_ids.map(Number);

      const seleccionadas = visitas.filter((visita) =>
        idsSolicitados.includes(Number(visita.id)),
      );

      if (seleccionadas.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          ok: false,
          error:
            "Ninguna de las visitas indicadas pertenece a esta casa y período",
        });
      }

      const [yaFacturadas] = await connection.query(
        `
        SELECT DISTINCT fd.horario_id
        FROM factura_detalles fd
        INNER JOIN facturas f ON f.id = fd.factura_id
        WHERE fd.horario_id IN (?)
          AND f.id <> ?
          AND f.estado IN ('emitida', 'pagada')
        `,
        [seleccionadas.map((visita) => visita.id), id],
      );

      if (yaFacturadas.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          ok: false,
          error: "Alguna de las visitas seleccionadas ya está incluida en una factura emitida",
        });
      }

      await connection.query("DELETE FROM factura_detalles WHERE factura_id = ?", [id]);

      const precio = Number(facturaActualizada.precio_por_hora);
      const impuesto = Number(facturaActualizada.porcentaje_impuesto);

      let totalMinutos = 0;
      let baseImponible = 0;

      for (const visita of seleccionadas) {
        const duracion =
          visita.duracion_facturable_minutos != null
            ? visita.duracion_facturable_minutos
            : visita.duracion_habitual_minutos;

        const duracionFinal = duracion != null ? duracion : 0;
        const importe = duracion != null ? calcularImporte(duracion, precio) : 0;

        totalMinutos += duracionFinal;
        baseImponible = redondear2(baseImponible + importe);

        await connection.query(
          `
          INSERT INTO factura_detalles (
            factura_id, horario_id, fecha_servicio, nombre_casa, descripcion,
            hora_inicio, hora_fin, duracion_facturable_minutos, precio_por_hora, importe
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            id,
            visita.id,
            visita.fecha,
            visita.nombre_casa,
            `Servicio de limpieza - ${visita.nombre_casa}`,
            visita.hora_inicio,
            visita.hora_fin,
            duracionFinal,
            precio,
            importe,
          ],
        );
      }

      const importeImpuesto = redondear2((baseImponible * impuesto) / 100);
      const total = redondear2(baseImponible + importeImpuesto);

      await connection.query(
        `
        UPDATE facturas
        SET horas_totales_minutos = ?, base_imponible = ?, importe_impuesto = ?, total = ?
        WHERE id = ?
        `,
        [totalMinutos, baseImponible, importeImpuesto, total, id],
      );
    }

    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Borrador actualizado",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error actualizando borrador:", error);
    res.status(500).json({
      ok: false,
      error: "Error actualizando borrador de factura",
    });
  } finally {
    connection.release();
  }
});

// DELETE /api/facturas/:id (solo borrador)
router.delete("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    const [facturas] = await connection.query(
      "SELECT estado FROM facturas WHERE id = ?",
      [id],
    );

    if (facturas.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    if (facturas[0].estado !== "borrador") {
      return res.status(400).json({
        ok: false,
        error: "Solo se pueden eliminar facturas en borrador",
      });
    }

    await connection.beginTransaction();
    await connection.query("DELETE FROM factura_detalles WHERE factura_id = ?", [id]);
    await connection.query("DELETE FROM facturas WHERE id = ?", [id]);
    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Borrador eliminado",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error eliminando borrador:", error);
    res.status(500).json({
      ok: false,
      error: "Error eliminando borrador",
    });
  } finally {
    connection.release();
  }
});

// POST /api/facturas/:id/emitir
router.post("/:id/emitir", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [facturas] = await connection.query(
      "SELECT * FROM facturas WHERE id = ? FOR UPDATE",
      [id],
    );

    if (facturas.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    const factura = facturas[0];

    if (factura.estado !== "borrador") {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "Solo se pueden emitir facturas en borrador",
      });
    }

    const [detalles] = await connection.query(
      "SELECT * FROM factura_detalles WHERE factura_id = ?",
      [id],
    );

    if (detalles.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "La factura no tiene líneas",
      });
    }

    // Validar duraciones desconocidas
    const conDesconocida = detalles.find(
      (detalle) => !detalle.duracion_facturable_minutos || detalle.duracion_facturable_minutos <= 0,
    );

    if (conDesconocida) {
      await connection.rollback();
      return res.status(400).json({
        ok: false,
        error: "Hay visitas con duración facturable desconocida. Resuélvelas antes de emitir",
      });
    }

    // Evitar duplicar visitas ya emitidas en otra factura
    const horarioIds = detalles.map((detalle) => detalle.horario_id).filter(Boolean);
    if (horarioIds.length > 0) {
      const [duplicadas] = await connection.query(
        `
        SELECT DISTINCT fd.horario_id
        FROM factura_detalles fd
        INNER JOIN facturas f ON f.id = fd.factura_id
        WHERE fd.horario_id IN (?)
          AND f.id <> ?
          AND f.estado IN ('emitida', 'pagada')
        `,
        [horarioIds, id],
      );

      if (duplicadas.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          ok: false,
          error: "Alguna visita ya está incluida en otra factura emitida",
        });
      }
    }

    // Generar número de factura si no existe
    let numeroFactura = factura.numero_factura;

    if (!numeroFactura) {
      const [maxResult] = await connection.query(
        "SELECT COALESCE(MAX(id), 0) AS max_id FROM facturas",
      );
      const siguiente = Number(maxResult[0].max_id) + 1;
      numeroFactura = `FAC-${new Date().getFullYear()}-${String(siguiente).padStart(5, "0")}`;
    }

    // Recalcular importes en servidor
    const precio = Number(factura.precio_por_hora);
    const impuesto = Number(factura.porcentaje_impuesto);

    let totalMinutos = 0;
    let baseImponible = 0;

    for (const detalle of detalles) {
      const importe = calcularImporte(detalle.duracion_facturable_minutos, precio);
      totalMinutos += detalle.duracion_facturable_minutos;
      baseImponible = redondear2(baseImponible + importe);

      await connection.query(
        "UPDATE factura_detalles SET importe = ?, precio_por_hora = ? WHERE id = ?",
        [importe, precio, detalle.id],
      );
    }

    const importeImpuesto = redondear2((baseImponible * impuesto) / 100);
    const total = redondear2(baseImponible + importeImpuesto);

    await connection.query(
      `
      UPDATE facturas
      SET estado = 'emitida',
          numero_factura = ?,
          fecha_emision = COALESCE(fecha_emision, CURDATE()),
          horas_totales_minutos = ?,
          base_imponible = ?,
          importe_impuesto = ?,
          total = ?
      WHERE id = ?
        AND estado = 'borrador'
      `,
      [numeroFactura, totalMinutos, baseImponible, importeImpuesto, total, id],
    );

    await connection.commit();

    res.json({
      ok: true,
      mensaje: "Factura emitida correctamente",
      numero_factura: numeroFactura,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error emitiendo factura:", error);
    if (error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "El número de factura ya existe",
      });
    }
    res.status(500).json({
      ok: false,
      error: "Error emitiendo factura",
    });
  } finally {
    connection.release();
  }
});

// PATCH /api/facturas/:id/estado
router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ["borrador", "emitida", "pagada", "anulada"];

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        ok: false,
        error: "Estado no válido",
      });
    }

    const [facturas] = await db.query("SELECT estado FROM facturas WHERE id = ?", [id]);

    if (facturas.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    const actual = facturas[0].estado;

    const transiciones = {
      // "emitida" solo se alcanza con POST /:id/emitir, que recalcula importes
      borrador: ["anulada"],
      emitida: ["pagada", "anulada"],
      pagada: ["anulada"],
      anulada: [],
    };

    if (!transiciones[actual].includes(estado)) {
      return res.status(400).json({
        ok: false,
        error: `No se puede cambiar de ${actual} a ${estado}`,
      });
    }

    const [resultado] = await db.query(
      "UPDATE facturas SET estado = ? WHERE id = ? AND estado = ?",
      [estado, id, actual],
    );

    if (resultado.affectedRows === 0) {
      return res.status(409).json({
        ok: false,
        error: "La factura cambió de estado mientras se procesaba la petición",
      });
    }

    res.json({
      ok: true,
      mensaje: "Estado actualizado",
    });
  } catch (error) {
    console.error("Error actualizando estado:", error);
    res.status(500).json({
      ok: false,
      error: "Error actualizando estado de factura",
    });
  }
});

// GET /api/facturas/:id/pdf
router.get("/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params;

    const [facturas] = await db.query(
      `
      SELECT f.*, c.nombre AS casa_nombre
      FROM facturas f
      INNER JOIN casas c ON c.id = f.casa_id
      WHERE f.id = ?
      `,
      [id],
    );

    if (facturas.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Factura no encontrada",
      });
    }

    const factura = facturas[0];

    const [detalles] = await db.query(
      `
      SELECT *
      FROM factura_detalles
      WHERE factura_id = ?
      ORDER BY fecha_servicio ASC, id ASC
      `,
      [id],
    );

    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="factura-${factura.numero_factura || factura.id}.pdf"`,
      );
      res.send(buffer);
    });

    doc.fontSize(18).text("FACTURA", { align: "center" });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Número: ${factura.numero_factura || "BORRADOR"}`);
    doc.text(`Fecha de emisión: ${factura.fecha_emision || "-"}`);
    doc.text(`Período: ${factura.fecha_inicio_periodo} a ${factura.fecha_fin_periodo}`);
    doc.text(`Estado: ${factura.estado}`);
    doc.moveDown();

    doc.text("Emisor:");
    doc.text(`  ${factura.nombre_emisor || "-"}`);
    doc.text(`  ${factura.identificacion_emisor || "-"}`);
    doc.text(`  ${factura.direccion_emisor || "-"}`);
    doc.moveDown();

    doc.text("Cliente:");
    doc.text(`  ${factura.nombre_cliente}`);
    doc.text(`  ${factura.direccion_cliente || "-"}`);
    doc.moveDown();

    doc.text("Detalle de visitas:");
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 120;
    const col3 = 260;
    const col4 = 330;
    const col5 = 400;
    const col6 = 470;

    doc.font("Helvetica-Bold");
    doc.text("Fecha", col1, tableTop);
    doc.text("Descripción", col2, tableTop);
    doc.text("Horas", col3, tableTop);
    doc.text("Precio/h", col4, tableTop);
    doc.text("Importe", col5, tableTop);
    doc.font("Helvetica");

    let y = tableTop + 15;

    for (const detalle of detalles) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const horas = (detalle.duracion_facturable_minutos / 60).toFixed(2);
      doc.text(String(detalle.fecha_servicio).slice(0, 10), col1, y);
      doc.text(detalle.descripcion || "", col2, y, { width: 130 });
      doc.text(horas, col3, y);
      doc.text(Number(detalle.precio_por_hora).toFixed(2), col4, y);
      doc.text(Number(detalle.importe).toFixed(2), col5, y);
      y += 20;
    }

    doc.moveDown();
    y = doc.y + 10;

    doc.text(`Base imponible: ${Number(factura.base_imponible).toFixed(2)}`);
    doc.text(`Impuesto (${factura.porcentaje_impuesto}%): ${Number(factura.importe_impuesto).toFixed(2)}`);
    doc.text(`Total: ${Number(factura.total).toFixed(2)}`);

    if (factura.observaciones) {
      doc.moveDown();
      doc.text(`Observaciones: ${factura.observaciones}`);
    }

    doc.end();
  } catch (error) {
    console.error("Error generando PDF:", error);
    res.status(500).json({
      ok: false,
      error: "Error generando PDF",
    });
  }
});

module.exports = router;