# Two-body: recommended use and limits

[Propagation](../index.md) · [Two-body](../two-body.md) · [Cowell](../cowell.md)

## When to use it

Use two-body when simplicity is an advantage:

- learning Keplerian elements and ellipse geometry;
- quick visualisation of an ideal manual orbit;
- testing element-to-Cartesian state conversions;
- a baseline for comparing what changes when forces are added in Cowell;
- deterministic tests where a numerical integrator would add another source
  of differences.

## When not to use it

Do not use this model as a final result for operational prediction, re-entry
analysis, long-term orbits, orbit determination, precise visibility windows,
or risk assessment. For a real satellite, even in LEO, J2 gradually rotates
the orbital plane and drag changes energy; both effects are absent here.

It also does not represent manoeuvres, third bodies, solar radiation pressure,
relativity, high-order geopotential, covariance, or events. Its speed does not
compensate for physics that are not in the model.

## Two-body compared with Cowell

| Aspect | Two-body | Cowell in Orbit |
| --- | --- | --- |
| Input | Keplerian elements | Cartesian state and epoch |
| Type | Analytical | Numerical, integrated with RK4 |
| Dynamics | Central gravity only | Central gravity plus available terms |
| Time step | None | Fixed: 60 s currently |
| Best use | Reference and learning | Physical studies and force validation |

Cowell is not always “more accurate”: it can only be better when its forces
and step represent the case more closely. To isolate a difference or teach
orbital geometry, two-body is usually the clearer choice.
