require("dotenv").config();
const app = require("./src/app");
const { iniciarProgramador } = require("./src/services/backup.service");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);

  // Copias automáticas: se ejecutan en el servidor, sin depender del navegador.
  iniciarProgramador();
});
