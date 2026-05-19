
import FreeCAD
import Mesh
import Import

step_path = "C:/Users/Bez/Documents/GitHub/microscope_builder_4/.cache/mechanical-step-source/tl10x-2p-8e0cbb241bbd.step"
out_path = "C:/Users/Bez/Documents/GitHub/microscope_builder_4/public/catalog/mechanical/objectives/tl10x-2p.wrl"

doc = Import.open(step_path)
if doc is None:
    doc = FreeCAD.ActiveDocument
if doc is None:
    raise RuntimeError("FreeCAD did not create a document for the STEP file")
objects = list(doc.Objects)
if not objects:
    raise RuntimeError("No solids imported from STEP file")
Mesh.export(objects, out_path)
FreeCAD.closeDocument(doc.Name)
