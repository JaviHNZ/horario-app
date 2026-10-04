const express = require("express");
const db = require("../config/db");

const router = express.Router();

// 
// GET /api/casas
router.get("/", async (req, res) => {
    try {
        const [casas] = await db.query(`
            SELECT
                id,
                nombre,
                direccion,
                duracion_minutos,
                activo,
                fecha_creacion,
                fecha_actualizacion
            FROM casas
            ORDER BY nombre ASC
        `);

        res.json({
            ok: true,
            casas
        });

    } catch (error) {
        console.error("Error obteniendo casas:", error);

        res.status(500).json({
            ok: false,
            error: "Error obteniendo casas"
        });
    }
});


// POST /api/casas
router.post("/", async (req, res) => {
    try {
        const {
            nombre,
            direccion,
            duracion_minutos
        } = req.body;

        if (!nombre) {
            return res.status(400).json({
                ok: false,
                error: "El nombre de la casa es obligatorio"
            });
        }

        const [resultado] = await db.query(
            `
            INSERT INTO casas (
                nombre,
                direccion,
                duracion_minutos
            )
            VALUES (?, ?, ?)
            `,
            [
                nombre.trim(),
                direccion?.trim() || null,
                duracion_minutos || null
            ]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Casa creada correctamente",
            casa: {
                id: resultado.insertId,
                nombre: nombre.trim(),
                direccion: direccion?.trim() || null,
                duracion_minutos: duracion_minutos || null
            }
        });

    } catch (error) {
        console.error("Error creando casa:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Esa casa ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error creando casa"
        });
    }
});


module.exports = router;