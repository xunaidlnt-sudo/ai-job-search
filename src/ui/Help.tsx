export function Help({ onClose, onDemo }: { onClose: () => void; onDemo: () => void }) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help" role="dialog" aria-label="Getting started" onClick={(e) => e.stopPropagation()}>
        <img src="./stratum-logo.png" alt="Stratum 4D" className="help-logo" />
        <h2>Getting started</h2>
        <p className="muted">Four steps from a P6 export and an IFC model to a 4D sequence.</p>
        <ol>
          <li>
            <b>Import schedule.</b> Export your project from Primavera P6 as XER, or from MS Project as XML. Stratum reads WBS, activities, logic, activity codes, actuals and baseline dates.
          </li>
          <li>
            <b>Import IFC.</b> Export the model from Revit, ArchiCAD, Tekla or similar as IFC2x3 or IFC4.
          </li>
          <li>
            <b>Link.</b> Fastest: <i>Rules → Find matching properties</i>, which looks for a model parameter that already holds Activity IDs or activity codes. Otherwise select elements in 3D (or <i>Selection → Select by property</i>), pick an activity in the Gantt, choose a profile and press <i>Link</i>.
          </li>
          <li>
            <b>Play and check.</b> Press Play. The <i>Check</i> tab lists activities with nothing linked, elements never shown, and broken links.
          </li>
        </ol>
        <h3>Planning in Stratum</h3>
        <p>
          Pick an activity and open the <i>Activity</i> tab to change durations, logic, constraints, progress and resources, or add new activities. Press <kbd>F9</kbd> to
          reschedule (critical path, late dates, float). <i>Export → P6 XER</i> takes the result back to Primavera; <i>CSV</i> goes to Excel.
        </p>
        <p>
          <i>Cost &amp; EVM</i> shows earned value and S-curves, <i>Resources</i> the weekly histogram, and <i>Quantities</i> what is installed by the playback date from the model's
          quantities. The <i>Tools</i> tab groups elements, splits slabs and walls into pours, and moves cranes or plant along a path.
        </p>
        <h3>Weekly updates</h3>
        <p>
          Import the new XER over the open project and choose <i>Update</i>. Links are kept by Activity ID, and the <i>Check</i> tab shows what moved: finish slip, status changes, and new activities that still need links.
        </p>
        <h3>Your work is autosaved</h3>
        <p>
          Links, rules and profiles are saved in this browser every few seconds. Use <i>Save project</i> to keep a file or share it.
        </p>
        <h3>Keyboard</h3>
        <table>
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>Play / pause</td></tr>
            <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step one day</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd></td><td>Step one week</td></tr>
            <tr><td><kbd>Home</kbd> / <kbd>End</kbd></td><td>Start / finish of schedule</td></tr>
            <tr><td>Click / <kbd>Shift</kbd>-click in 3D</td><td>Select / add to selection</td></tr>
            <tr><td><kbd>Alt</kbd>-click activity</td><td>Select its linked elements</td></tr>
            <tr><td>Double-click activity</td><td>Jump timeline to its start</td></tr>
            <tr><td><kbd>F9</kbd></td><td>Schedule (CPM)</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Cancel path drawing / close help</td></tr>
            <tr><td><kbd>?</kbd></td><td>This help</td></tr>
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onDemo}>Try the demo</button>
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
