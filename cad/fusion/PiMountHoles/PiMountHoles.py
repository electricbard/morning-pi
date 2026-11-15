"""Morning Pi case: project the Raspberry Pi mounting holes onto the case floor
and cut screw clearance holes through it.

Run from Fusion: Utilities > Add-Ins > Scripts and Add-Ins > PiMountHoles > Run.

1. Click the case's bottom face (any face of the floor that is parallel to the Pi).
2. Click each Raspberry Pi mounting hole: its round edge, its bore, or the
   standoff sitting on it (cylindrical face or circular edge). Press Esc /
   Cancel when done (normally after 4).

The script makes a sketch on that face called "Pi mounting holes" with a point
at each projected hole centre (plus a circle at the clearance size), then cuts
the circles through the case body only. Nothing else in the design is touched,
and everything shows up as normal timeline features you can edit or delete.
"""

import traceback

import adsk.core
import adsk.fusion

CLEARANCE_DIAMETER_MM = 2.9   # M2.5 screw, ISO 273 "medium" clearance; good for 3D prints
SKETCH_NAME = 'Pi mounting holes'


def _world_point(entity):
    """Centre of a circular edge, or a point on the axis of a cylindrical face, in world space."""
    geom = entity.geometry
    if isinstance(geom, (adsk.core.Circle3D, adsk.core.Arc3D)):
        return geom.center.copy()
    if isinstance(geom, adsk.core.Cylinder):
        return geom.origin.copy()
    raise ValueError('Pick a round edge or a cylindrical face.')


def _to_component_space(pt, occurrence):
    """World point -> the coordinate space of the component that owns the sketch."""
    if occurrence is None:
        return pt
    m = occurrence.transform2.copy()
    m.invert()
    p = pt.copy()
    p.transformBy(m)
    return p


def run(_context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Open the case design first.')
            return
        if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            ui.messageBox('This script needs a parametric design (timeline on).')
            return

        sel = ui.selectEntity('Select the bottom face of the case', 'PlanarFaces')
        face = adsk.fusion.BRepFace.cast(sel.entity)
        body = face.body
        occ = face.assemblyContext  # None if the case body lives in the root component
        comp = occ.component if occ else design.rootComponent

        centres = []
        while True:
            n = len(centres) + 1
            try:
                s = ui.selectEntity(
                    f'Select Pi mounting hole {n} (round edge, bore or standoff). Esc when done.',
                    'CircularEdges,CylindricalFaces')
            except RuntimeError:
                break  # user pressed Esc / Cancel
            centres.append(_world_point(s.entity))
            if n >= 8:
                break
        if not centres:
            ui.messageBox('No holes selected; nothing changed.')
            return

        # A face inside a sub-component comes back as a proxy; Fusion wants the
        # proxy plus the occurrence to build the sketch in the case's component.
        sketch = comp.sketches.add(face, occ) if occ else comp.sketches.add(face)
        # Work on the native sketch so every coordinate is in the case component's space.
        sketch = sketch.nativeObject if sketch.assemblyContext else sketch
        sketch.name = SKETCH_NAME
        r_cm = CLEARANCE_DIAMETER_MM / 10.0 / 2.0  # Fusion's internal unit is cm

        report = []
        for wp in centres:
            p = sketch.modelToSketchSpace(_to_component_space(wp, occ))
            p.z = 0  # drop onto the face plane = projection along the face normal
            sp = sketch.sketchPoints.add(p)
            sketch.sketchCurves.sketchCircles.addByCenterRadius(sp, r_cm)
            report.append(f'({p.x * 10:.2f}, {p.y * 10:.2f}) mm')

        # Pick out the small circle profiles we just drew.
        target_area = 3.14159265 * r_cm * r_cm
        profiles = adsk.core.ObjectCollection.create()
        for prof in sketch.profiles:
            if abs(prof.areaProperties().area - target_area) / target_area < 0.05:
                profiles.add(prof)
        if profiles.count == 0:
            ui.messageBox('Sketch made, but no hole profiles found to cut. Check the sketch.')
            return

        extrudes = comp.features.extrudeFeatures
        ext_in = extrudes.createInput(profiles, adsk.fusion.FeatureOperations.CutFeatureOperation)
        through = adsk.fusion.ThroughAllExtentDefinition.create()
        ext_in.setTwoSidesExtent(through, through)  # works whichever way the face points
        ext_in.participantBodies = [body.nativeObject if occ else body]           # only cut the case, never the Pi or display
        cut = extrudes.add(ext_in)
        cut.name = 'Pi mounting clearance holes'

        ui.messageBox(
            f'Made {len(centres)} clearance hole(s), Ø{CLEARANCE_DIAMETER_MM} mm, '
            f'in sketch "{SKETCH_NAME}".\n\nCentres in sketch coordinates:\n' + '\n'.join(report))
    except Exception:  # noqa: BLE001 - show any failure in Fusion
        ui.messageBox('PiMountHoles failed:\n' + traceback.format_exc())
