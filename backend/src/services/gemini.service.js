const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const { response } = require("../app");

// reglas que no tiene que romper
const casas = require("../data/casas");
const trabajadores = require("../data/trabajadores");
// 

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

async function analizarHorario(rutaImagen, mimeType) {
  const imagenData = fs.readFileSync(rutaImagen);
  const base64Image = imagenData.toString("base64");

const prompt = `
Analiza cuidadosamente esta imagen de un horario de trabajo escrito a mano.

La imagen contiene diferentes servicios. Cada servicio normalmente tiene:

1. Nombre de una casa.
2. Hora de inicio y hora de finalización.
3. Iniciales de uno o varios trabajadores.

LISTA DE CASAS VÁLIDAS:

${casas.join(", ")}

LISTA DE CÓDIGOS DE TRABAJADORES VÁLIDOS:

${trabajadores.join(", ")}

REGLAS IMPORTANTES:

1. Solo puedes utilizar nombres de casas que aparezcan en la lista de casas válidas.
2. Solo puedes utilizar códigos de trabajadores que aparezcan en la lista de trabajadores válidos.
3. Si el texto manuscrito parece ser una variante o tiene un pequeño error de lectura, intenta asociarlo con el elemento más parecido de las listas.
4. NO inventes casas.
5. NO inventes trabajadores.
6. Conserva correctamente las relaciones entre casa, horario y trabajadores según su posición en la imagen.
7. Una casa puede tener uno o varios trabajadores.
8. Las horas deben estar en formato HH:MM.
9. Si no puedes determinar una hora con suficiente seguridad, utiliza null.
10. Si no puedes determinar una casa con suficiente seguridad, utiliza null.
11. Si no puedes determinar un trabajador con suficiente seguridad, no lo inventes.
12. Extrae TODOS los servicios visibles en la imagen.

Devuelve exclusivamente un JSON válido.

Formato obligatorio:

{
  "servicios": [
    {
      "casa": "CARMEN",
      "hora_inicio": "08:00",
      "hora_fin": "10:00",
      "trabajadores": ["JE"]
    }
  ]
}
`;
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image,
          },
        },
        { text: prompt },
      ],
      config: {
        responseMimeType: "application/json",
      },
    },
  });
  console.log("RESPUESTA DE GEMINI:");
console.log(response.text);

  let texto = response.text.trim();

  // Si Gemini devuelve un bloque Markdown ```json ... ```
  if (texto.startsWith("```")) {
    texto = texto.replace(/^```(?:json)?\s*/i, "");
    texto = texto.replace(/\s*```$/, "");
  }

  return JSON.parse(texto);
}

module.exports = {
  analizarHorario,
};
