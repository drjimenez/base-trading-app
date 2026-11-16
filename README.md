# Base Trading — app para iPhone (PWA)

Web app instalable que consulta la base de datos de trading en Supabase, con reportes de probabilidad estilo Edgeful.

- **En juego:** patrones formados en la última vela de cada activo y su frecuencia histórica.
- **Reportes:** gap fill, rango del día previo, día interior, apertura fuera del rango, máximo/mínimo semanal por día, rango diario (ADR).
- **Mercados:** precios, gráfico de velas con medias 50/200 y probabilidades históricas.
- **Estado:** salud de la base y de los agentes.

Instalar en iPhone: abrir la URL en Safari → Compartir → "Agregar a pantalla de inicio".

Seguridad: la clave de Supabase incluida es la *publishable* (pública por diseño). Los datos solo se entregan a usuarios con sesión iniciada que estén en `trading.usuarios_permitidos`.
