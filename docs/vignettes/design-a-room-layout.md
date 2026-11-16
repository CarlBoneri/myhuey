# Design a room layout in Studio

You are setting up an office and want to see its real dimensions, furniture, doors, windows, and
lights together before you use that layout day to day. This walkthrough creates the design in a
sandbox, so your Active layout stays unchanged while you work.

## Scenario

The office is 12 feet wide by 14 feet deep. You want to add its desk, mark a window and a door,
and place the Hue lights where they sit in the room. You do not have a floor-plan image, so you
will draw the room from its dimensions. The desk goes under the window on the north wall; the
door is on the south wall.

If you have not installed MyHuey or paired the bridge yet, follow [Install MyHuey and open the web
app](install-and-run.md). Pairing is only needed to import rooms or place real bridge lights;
you can draw the room without a bridge.

## Start a sandbox

1. Open Studio and choose the whole-home floor plan.
2. In the **Layouts** panel, choose **Start fresh**. MyHuey creates and opens a sandbox. The
   Active layout remains the one used by Home.
3. Check the sandbox banner before editing. It reads "Sandbox: *name*, not active" and stays at
   the top of every screen while the sandbox is open.

Starting fresh gives you a layout with no rooms and no scenes. It keeps the Active layout's
floor-plan image, if there is one. To keep an existing plan and change only one room, choose
**Duplicate** on that layout in the **Layouts** panel instead: MyHuey copies it into a sandbox
and opens the copy for you.

## Add the room

In the **Add a room** panel, enter the name, replace the suggested width and depth, then choose
**Add room**:

| Field | Value |
| --- | --- |
| Name | `Office` |
| Width | `12 ft` |
| Depth | `14 ft` |

MyHuey opens the new room's plan. The outline is drawn to scale, and its edges show their
dimensions. The plan has no compass, so this guide uses the convention MyHuey's assistant tools
use: the top edge is north, x grows to the right, and y grows down. Place the desk against the
top edge with its front facing into the room.

If you need a different shape, return to the whole-home plan, choose **Draw a room** in the
toolbar, select **Rectangle**, **L-shape**, or **Corners**, and draw the outline. Drag out a
rectangle or an L-shape. For a polygon made corner by corner, click each corner and close the
shape at its first corner, with a double-click, or with Enter. Then type a name in the **New
outline** panel and choose **Add room**. The outline is not saved as a room until you do.

## Add the room's details

In the room plan:

1. In the **Furniture** panel, click **Desk**. The desk appears near the middle of the room; drag
   it into place. Select it to adjust its label, width, depth, height, or rotation.
2. Choose **Add doors and windows** in the toolbar, select **Window**, and click the north wall.
   Switch to **Door** and click the south wall. Select an opening to adjust its width.
3. If the bridge is paired, drag the room's real lights from the **Lights to place** panel onto
   the plan, or use the plus button beside a light. To plan a product you do not own yet, drag it
   from the **Catalog** in the **Plan lights** panel instead. Planned lights help with layout and
   suggestions; they are not sent to the bridge.
4. Switch the view to **3D** to inspect the room, furniture, openings, and light positions
   together.

Changes save as you make them. You can leave the room and return to the sandbox later.

## If you have a floor-plan image

On the whole-home plan, upload a JPEG, PNG, or WebP image in the **Plan image** panel. MyHuey
selects **Set the scale** in the toolbar for you: drag a line over a printed dimension, enter its
real length (for example, `12 ft 6 in`), and choose **Set scale**. MyHuey then selects **Trace a
room**: hover inside a room to preview its outline and click to keep it. Type a name in the **New
outline** panel and choose **Add room**; the traced outline is not saved as a room until you do.

If the trace crosses a doorway, raise **Close door gaps**. If a small room disappears, lower it.
You can also choose **Draw a room** and make the outline by hand over the image.

## Check the result

The room plan should show the 12-by-14-foot office, the desk under the north window, the door on
the south wall, and the lights at their relative positions. The 3D view should make it easier to
spot furniture or lights that overlap or sit outside the room.

The sandbox is still separate from Active. Return to the sandbox banner when you are ready to
review the layout. A sandbox does not become Active automatically. Only you can choose **Make
active**, in the banner, and only when you intend this layout to take the place of the current
Active layout. The layout that was Active is kept as a sandbox, so nothing is lost. Otherwise,
leave the sandbox as it is and choose **Back to Active** when you are done.

Designing the room does not by itself change the Hue lights. Previewing a scene or using a light
control is a separate action.
