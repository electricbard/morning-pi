"""Morning Pi case: build a simple reference model of the Raspberry Pi 7" Touch Display
(original, v1) with a Raspberry Pi 4 mounted on its back, so the case can be
designed around it and PiMountHoles has real holes to click.

All sizes come from the official mechanical drawing (RP-008246, LCD module
D/5624/KIT-LC-V3) and the Raspberry Pi 4 mechanical drawing. Only the parts
that matter for a case are modelled: front glass, metal back frame with its
M3 and M2.5 holes, the Pi standoffs, the Pi board and a block for the
USB/Ethernet ports.

Coordinates (component space, mm): looking at the FRONT of the screen, the glass
is centred on the origin, X to the right, Y up, the glass front face at Z = 0
and everything else behind it (negative Z). Move/align the new component to
your case afterwards (Move or a joint).

Run: Utilities > Add-Ins > Scripts and Add-Ins > DisplayPiReference > Run.
"""

import traceback

import adsk.core
import adsk.fusion

# ---- settings you may want to change -------------------------------------------------
PI_STANDOFF_MM = 12.0      # gap between the display's metal back and the Pi board. Measure yours.
PORTS_TO_THE = 'left'      # USB/Ethernet end of the Pi, as seen from the FRONT: 'left' or 'right'. Check yours.
GLASS_CORNER_R_MM = 7.0    # not dimensioned on the drawing; scaled from it (about 7 mm)
# Check with a ruler: screen face down, ribbon cable towards you. From the glass's LEFT edge
# to the centre of the nearest Pi screw should be about 61 mm. If it is about 74 mm instead,
# set this to True (the drawing's back view would then be see-through rather than mirrored).
FLIP_LEFT_RIGHT = False

# ---- from the official drawings (front view, glass centred on origin) ---------------
GLASS_W, GLASS_H, GLASS_T = 192.96, 110.76, 0.7
MODULE_T = 5.96                                   # glass front to back of metal frame
FRAME_X0, FRAME_X1 = -81.61, 84.59                # 166.2 wide
FRAME_Y0, FRAME_Y1 = -51.85, 48.75                # 100.6 tall, 3.53 above glass bottom
M25 = [(-22.51, -21.05), (35.49, -21.05), (-22.51, 27.95), (35.49, 27.95)]  # 58 x 49 Pi pattern
M3 = [(-61.61, -31.85), (64.59, -31.85), (-61.61, 33.80), (64.59, 33.80)]   # 126.2 x 65.65
PI_W, PI_H, PI_T, PI_HOLE_INSET = 85.0, 56.0, 1.4, 3.5
PORT_BLOCK_LEN, PORT_BLOCK_H, PORT_OVERHANG = 21.0, 16.0, 2.0  # USB stack is the tallest (~16 mm)


def _p(x, y, z=0.0):
    return adsk.core.Point3D.create(x / 10.0, y / 10.0, z / 10.0)  # mm -> Fusion cm


def _v(mm):
    return adsk.core.ValueInput.createByReal(mm / 10.0)


def _plane_at(comp, z_mm):
    planes = comp.constructionPlanes
    inp = planes.createInput()
    inp.setByOffset(comp.xYConstructionPlane, _v(z_mm))
    plane = planes.add(inp)
    plane.isLightBulbOn = False
    return plane


def _slab(comp, name, z_top, depth, x0, y0, x1, y1, holes=(), hole_d=0.0):
    """Rectangle (with optional round holes) from z_top going `depth` mm towards -Z."""
    sk = comp.sketches.add(_plane_at(comp, z_top))
    sk.name = name
    sk.sketchCurves.sketchLines.addTwoPointRectangle(_p(x0, y0), _p(x1, y1))
    for hx, hy in holes:
        sk.sketchCurves.sketchCircles.addByCenterRadius(_p(hx, hy), hole_d / 20.0)
    prof = max(sk.profiles, key=lambda pr: pr.areaProperties().area)  # the plate, minus its holes
    ext = comp.features.extrudeFeatures.addSimple(
        prof, _v(-depth), adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    body = ext.bodies.item(0)
    body.name = name
    return body


def _round_vertical_edges(comp, body, r_mm):
    edges = adsk.core.ObjectCollection.create()
    for e in body.edges:
        g = e.geometry
        if isinstance(g, adsk.core.Line3D):
            s, t = g.startPoint, g.endPoint
            if abs(s.x - t.x) < 1e-6 and abs(s.y - t.y) < 1e-6:
                edges.add(e)
    fillets = comp.features.filletFeatures
    inp = fillets.createInput()
    try:
        inp.edgeSetInputs.addConstantRadiusEdgeSet(edges, _v(r_mm), True)
    except AttributeError:  # older API
        inp.addConstantRadiusEdgeSet(edges, _v(r_mm), True)
    fillets.add(inp)


def run(_context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design or design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            ui.messageBox('Open the case design (parametric, timeline on) first.')
            return
        global M25, M3, FRAME_X0, FRAME_X1
        if FLIP_LEFT_RIGHT:
            M25 = [(-x, y) for x, y in M25]
            M3 = [(-x, y) for x, y in M3]
            FRAME_X0, FRAME_X1 = -FRAME_X1, -FRAME_X0
        occ = design.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = 'Pi 7in display + Pi 4 (reference)'

        # Front glass with rounded corners.
        glass = _slab(comp, 'Glass', 0.0, GLASS_T,
                      -GLASS_W / 2, -GLASS_H / 2, GLASS_W / 2, GLASS_H / 2)
        _round_vertical_edges(comp, glass, GLASS_CORNER_R_MM)

        # LCD + metal back frame, with M3 (display mounting) and M2.5 (Pi) holes.
        _slab(comp, 'LCD and metal back frame', -GLASS_T, MODULE_T - GLASS_T,
              FRAME_X0, FRAME_Y0, FRAME_X1, FRAME_Y1)
        back = -MODULE_T
        sk = comp.sketches.add(_plane_at(comp, back))
        sk.name = 'Back frame holes'
        for hx, hy in M3:
            sk.sketchCurves.sketchCircles.addByCenterRadius(_p(hx, hy), 0.15)
        for hx, hy in M25:
            sk.sketchCurves.sketchCircles.addByCenterRadius(_p(hx, hy), 0.125)
        holes = adsk.core.ObjectCollection.create()
        for pr in sk.profiles:
            holes.add(pr)
        cut = comp.features.extrudeFeatures.createInput(holes, adsk.fusion.FeatureOperations.CutFeatureOperation)
        cut.setDistanceExtent(False, _v(3.0))  # 3 mm into the frame (positive = towards the glass)
        comp.features.extrudeFeatures.add(cut)

        # Pi standoffs (M2.5, 5 mm hex modelled as round).
        sk = comp.sketches.add(_plane_at(comp, back))
        sk.name = 'Pi standoffs'
        for hx, hy in M25:
            sk.sketchCurves.sketchCircles.addByCenterRadius(_p(hx, hy), 0.25)
            sk.sketchCurves.sketchCircles.addByCenterRadius(_p(hx, hy), 0.125)
        rings = adsk.core.ObjectCollection.create()
        for pr in sk.profiles:
            if pr.profileLoops.count == 2:  # the ring between the two circles
                rings.add(pr)
        so = comp.features.extrudeFeatures.addSimple(
            rings, _v(-PI_STANDOFF_MM), adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        for i in range(so.bodies.count):
            so.bodies.item(i).name = f'Pi standoff {i + 1}'

        # Pi 4 board, holes on the display's M2.5 pattern.
        xs = sorted({x for x, _ in M25})
        ys = sorted({y for _, y in M25})
        if PORTS_TO_THE == 'right':
            bx0 = xs[0] - PI_HOLE_INSET
            bx1 = bx0 + PI_W
        else:
            bx1 = xs[1] + PI_HOLE_INSET
            bx0 = bx1 - PI_W
        by0 = ys[0] - PI_HOLE_INSET
        by1 = by0 + PI_H
        pi_top = back - PI_STANDOFF_MM  # side of the board facing the display
        _slab(comp, 'Raspberry Pi 4 board', pi_top, PI_T, bx0, by0, bx1, by1, holes=M25, hole_d=2.7)

        # USB / Ethernet block on the far side of the board (worst-case height).
        comp_side = pi_top - PI_T
        if PORTS_TO_THE == 'right':
            px0, px1 = bx1 - PORT_BLOCK_LEN, bx1 + PORT_OVERHANG
        else:
            px0, px1 = bx0 - PORT_OVERHANG, bx0 + PORT_BLOCK_LEN
        _slab(comp, 'USB + Ethernet ports', comp_side, PORT_BLOCK_H, px0, by0 + 1.5, px1, by1 - 1.5)

        back_of_ports = -(MODULE_T + PI_STANDOFF_MM + PI_T + PORT_BLOCK_H)
        ui.messageBox(
            'Added "Pi 7in display + Pi 4 (reference)".\n\n'
            'Glass front face is at Z = 0, centred on the origin, seen from the front.\n'
            f'Pi standoff gap: {PI_STANDOFF_MM} mm; ports to the {PORTS_TO_THE} (from the front).\n'
            f'Deepest point (top of the USB ports): {back_of_ports:.1f} mm.\n\n'
            'Move it into place in your case, then run PiMountHoles and click the 4 holes in the Pi board.')
    except Exception:  # noqa: BLE001
        ui.messageBox('DisplayPiReference failed:\n' + traceback.format_exc())
