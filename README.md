# Base Trading — app para iPhone (PWA)

Web app instalable que consulta la base de datos de trading en Supabase, con reportes de probabilidad estilo Edgeful.

- **En juego:** patrones formados en la última vela de cada activo y su frecuencia histórica.
- **Reportes:** gap fill, rango del día previo, día interior, apertura fuera del rango, máximo/mínimo semanal por día, rango diario (ADR).
- **Mercados:** precios, gráfico de velas con medias 50/200 y probabilidades históricas.
- **Consultas:** caja de chat con el Analista IA (Agente 5). Cada pregunta se responde con SQL de solo lectura sobre la base, gráfico y resumen, y queda guardada como tarjeta que se puede volver a ejecutar con datos nuevos.
- **Reporte Balance inicial (IB):** cuánto tiempo se queda el precio dentro del rango de la primera hora (0–60, 60–120, 120+ min; desglose 0–30 / 30–60 con velas de 5 min) y qué proyección alcanza al romper (múltiplos del rango IB).
- **Estado:** salud de la base y de los agentes.

El chat usa la Edge Function `analista` de Supabase, que necesita el secreto `ANTHROPIC_API_KEY` (Supabase → Edge Functions → Secrets).

Instalar en iPhone: abrir la URL en Safari → Compartir → "Agregar a pantalla de inicio".

Seguridad: la clave de Supabase incluida es la *publishable* (pública por diseño). Los datos solo se entregan a usuarios con sesión iniciada que estén en `trading.usuarios_permitidos`.
