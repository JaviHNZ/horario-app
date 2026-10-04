require("dotenv").config();
const db = require("./src/config/db");

async function probarConexion() {
    try {
        const [rows] = await db.query("SELECT DATABASE() AS base_de_datos");

        console.log("✅ Conexión correcta");
        console.log(rows);

        process.exit(0);
    } catch (error) {
        console.error("❌ Error conectando a MySQL:");
        console.error(error.message);

        process.exit(1);
    }
}

probarConexion();
