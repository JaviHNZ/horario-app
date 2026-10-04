const express = require("express");
const db = require("../config/db");

const router = express.Router();


// GET /api/trabajadores
// Obtener todos los trabajadores
router.get("/", async (req, res) => {
    try {
        const [trabajadores] = await db.query(`
            SELECT
                id,
                nombre,
                codigo,
                activo,
                fecha_creacion,
                fecha_actualizacion
            FROM trabajadores
            ORDER BY nombre ASC
        `);

        res.json({
            ok: true,
            trabajadores
        });

    } catch (error) {
        console.error("Error obteniendo trabajadores:", error);

        res.status(500).json({
            ok: false,
            error: "Error obteniendo trabajadores"
        });
    }
});
// POST /api/trabajadores
// Crear un nuevo trabajador
router.post("/", async (req, res) => {
    try {
        const { nombre, codigo } = req.body;

        if (!nombre || !codigo) {
            return res.status(400).json({
                ok: false,
                error: "El nombre y el código son obligatorios"
            });
        }

        const [resultado] = await db.query(
            `
            INSERT INTO trabajadores (nombre, codigo)
            VALUES (?, ?)
            `,
            [nombre.trim(), codigo.trim().toUpperCase()]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Trabajador creado correctamente",
            trabajador: {
                id: resultado.insertId,
                nombre: nombre.trim(),
                codigo: codigo.trim().toUpperCase()
            }
        });

    } catch (error) {
        console.error("Error creando trabajador:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Ese código de trabajador ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error creando trabajador"
        });
    }
});

module.exports = router;