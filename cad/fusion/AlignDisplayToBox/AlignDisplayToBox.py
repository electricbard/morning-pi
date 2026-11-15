"""Morning Pi case: move the display + Pi reference (made by DisplayPiReference)
so the back of the glass sits on the top face of the case box, centred on it,
with the glass's long side along the box's long side.

Run: Utilities > Add-Ins > Scripts and Add-Ins > AlignDisplayToBox > Run,
then click the top face (rim) of the box. Run it again any time the box changes.
"""

import traceback

import adsk.core
import adsk.fusion

REF_PREFIX = 'REF - '
REF_COMPONENT = 'Pi 7in display + Pi 4 (reference)'
GLASS_W_MM, GLASS_H_MM = 192.96, 110.76


def _vec(a, b):
    return adsk.core.Vector3D.create(b.x - a.x, b.y - a.y, b.z - a.z)


def _sample_points(face):
    """Points along every edge of the face (arcs sampled), world space."""
    pts = []
    for e in face.edges:
        ev = e.evaluator
        ok, t0, t1 = ev.getParameterExtents()
        n = 1 if isinstance(e.geometry, adsk.core.Line3D) else 24
        for i in range(n + 1):
            ok, p = ev.getPointAtParameter(t0 + (t1 - t0) * i / n)
            if ok:
                pts.append(p)
    return pts


def _longest_line_dir(face):
    best, best_len = None, -1.0
    for e in face.edges:
        g = e.geometry
        if isinstance(g, adsk.core.Line3D):
            v = _vec(g.startPoint, g.endPoint)
            if v.length > best_len:
                best, best_len = v, v.length
    if best is None:
        raise ValueError('That face has no straight edges to set the direction from.')
    best.normalize()
    return best


def _frame(face, z_dir, x_hint=None):
    """Centre (of the face outline), X (long side) and Y on the face's plane."""
    x = _longest_line_dir(face)
    if x_hint is not None and x.dotProduct(x_hint) < 0:
        x.scaleBy(-1)
    y = z_dir.crossProduct(x)
    y.normalize()
    pts = _sample_points(face)
    o = pts[0]
    us = [_vec(o, p).dotProduct(x) for p in pts]
    vs = [_vec(o, p).dotProduct(y) for p in pts]
    cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
    centre = adsk.core.Point3D.create(o.x + x.x * cu + y.x * cv,
                                      o.y + x.y * cu + y.y * cv,
                                      o.z + x.z * cu + y.z * cv)
    size = (max(us) - min(us), max(vs) - min(vs))
    return centre, x, y, size


def _matrix(origin, x, y, z):
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(origin, x, y, z)
    return m


def _normal(face):
    ok, n = face.evaluator.getNormalAtPoint(face.pointOnFace)
    return n


def run(_context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        root = design.rootComponent

        # Find the reference parts: plain bodies (Part Design) or the reference component.
        ref_bodies = [b for b in root.bRepBodies if b.name.startswith(REF_PREFIX)]
        ref_occ = None
        for o in root.allOccurrences:
            if o.component.name == REF_COMPONENT:
                ref_occ = o
        if ref_occ:
            ref_bodies = [b.createForAssemblyContext(ref_occ) for b in ref_occ.component.bRepBodies]
        glass = next((b for b in ref_bodies if b.name.endswith('Glass')), None)
        if glass is None:
            ui.messageBox('Run DisplayPiReference first: no "REF - Glass" body found.')
            return
        frame = next(b for b in ref_bodies if 'back frame' in b.name)

        sel = ui.selectEntity('Select the top face (rim) of the box', 'PlanarFaces')
        box_face = adsk.fusion.BRepFace.cast(sel.entity)
        box_n = _normal(box_face)  # outward: the glass should face this way

        # Current placement of the glass: its back face is the big face nearest the frame.
        big = sorted([f for f in glass.faces if isinstance(f.geometry, adsk.core.Plane)],
                     key=lambda f: f.area, reverse=True)[:2]
        fc = frame.physicalProperties.centerOfMass
        back = min(big, key=lambda f: f.pointOnFace.distanceTo(fc))
        cur_z = _normal(back)
        cur_z.scaleBy(-1)  # glass front direction = away from the frame
        cur_c, cur_x, cur_y, _ = _frame(back, cur_z)

        tgt_c, tgt_x, tgt_y, box_size = _frame(box_face, box_n, x_hint=cur_x)

        # move = target * inverse(current): undo where the glass is now, then place it on the box.
        # (In Fusion, a.transformBy(b) makes a = b * a.)
        m = _matrix(cur_c, cur_x, cur_y, cur_z)
        m.invert()
        m.transformBy(_matrix(tgt_c, tgt_x, tgt_y, box_n))

        if ref_occ:
            t = ref_occ.transform2
            t.transformBy(m)
            ref_occ.transform2 = t
            if design.snapshots.hasPendingSnapshot:
                design.snapshots.add()
        else:
            coll = adsk.core.ObjectCollection.create()
            for b in ref_bodies:
                coll.add(b)
            moves = root.features.moveFeatures
            try:
                mi = moves.createInput2(coll)
                mi.defineAsFreeMove(m)
            except AttributeError:
                mi = moves.createInput(coll, m)
            mv = moves.add(mi)
            mv.name = 'Align display to box'

        bw, bh = box_size[0] * 10, box_size[1] * 10
        side = (GLASS_W_MM - bw) / 2
        topbot = (GLASS_H_MM - bh) / 2
        verdict = ('The box is hidden behind the glass.' if side >= 0 and topbot >= 0
                   else 'WARNING: the box sticks out past the glass.')
        ui.messageBox(
            f'Moved the display + Pi so the glass sits on the box, centred.\n\n'
            f'Box outline: {bw:.2f} × {bh:.2f} mm\n'
            f'Glass: {GLASS_W_MM} × {GLASS_H_MM} mm\n'
            f'Glass overhang: {side:.2f} mm each side, {topbot:.2f} mm top and bottom.\n'
            f'{verdict}')
    except Exception:  # noqa: BLE001
        ui.messageBox('AlignDisplayToBox failed:\n' + traceback.format_exc())
