# Integración Categoría +50

La aplicación usa un modelo local y derivado de resultados:

- `Categoría`: torneo, etapa actual y flujo de zonas.
- `Zona`: nombre y `teamIds`; las zonas iniciales de la demo son 4, 5, 6, 10 y 11.
- `Equipo`: nombre, categoría, estado y cargas de puntaje.
- `Partido`: ganador, perdedor, resultado (`2-0`/`2-1`), sets, fase y zona.
- `Set`: `{ a, b }`, orientado al ganador del partido.
- `Clasificación`: no se persiste; se calcula desde los partidos del alcance seleccionado.

## Cálculo

`standings(categoryId, stage, zoneId)` filtra los partidos del alcance, suma los
puntos de resultado, sets a favor/en contra y tantos a favor/en contra, y ordena
por:

1. Puntos de clasificación.
2. Tantos a favor.
3. Menos tantos en contra.
4. Nombre, como último criterio visual estable.

La interfaz nueva presenta esos datos en `Posiciones`, junto con cocientes SET,
PTOS y penalizaciones (`P.`), que comienza en cero y queda lista para futuras
reglas disciplinarias.

## Vistas

- `Partidos`: tabla con número, fase/zona, equipos, resultado y SET 1/2/3; los
  selectores filtran por fase y zona.
- `Posiciones`: una tabla por zona con PUNTOS, J, G, P, SF/SE, PG/PP,
  RESULTADOS y COCIENTES.

Los seis cruces de puestos de la demo se registran como partidos de fase final
sin `zoneId`, por lo que se muestran en `Partidos` pero no contaminan las tablas
de la fase de zonas.

