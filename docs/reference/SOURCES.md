# Brain view references

Public-domain plates from Henry Gray, *Anatomy of the Human Body*, 20th edition (1918), illustrated by Henry Vandyke
Carter (1831–1897), via Wikimedia Commons. They were traced once into the outline profiles in
`prototype/brain/shape.js`, and `prototype/brain/bench/views.mjs` overlays them on the brain view to check the shape.

| File | Shows | Source |
|---|---|---|
| `Gray718.png` | Coronal section through the temporal lobes (only the right half is drawn in full) | https://commons.wikimedia.org/wiki/File:Gray718.png |
| `Gray725.png` | Left cerebral hemisphere, viewed from above | https://commons.wikimedia.org/wiki/File:Gray725.png |
| `Gray703.png` | Cerebellum seen from the front: both hemispheres and the vermis (the same silhouette as from behind) | https://commons.wikimedia.org/wiki/File:Gray703.png |
| `Gray728.png` | Principal fissures and lobes of the cerebrum viewed laterally, lobes colored, the cerebellum below | https://commons.wikimedia.org/wiki/File:Gray728.png |
| `PSM_V41_D796_Left_side_of_the_brain.jpg` | The whole brain from the left, with the cerebellum and medulla (Popular Science Monthly, vol. 41, 1892) | https://commons.wikimedia.org/wiki/File:PSM_V41_D796_Left_side_of_the_brain.jpg |
| `Gray718-front.png` | Gray718's right half and its mirror image: a symmetric coronal outline | derived |
| `Gray725-top.png` | Gray725 and its mirror image: both hemispheres from above | derived |

The side view's region map (`SHAPE`) was traced from a reference illustration chosen by the owner that is not in this folder. `SHAPE_PD` is the same map traced from Gray 728 (lobes, cerebellum) with the brainstem from the 1892 plate, mapped onto Gray 728 by the cerebrum's bounding box; the prototype shows it with `?side=pd` until one is chosen.
