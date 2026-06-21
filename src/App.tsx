export default function App() {
  const commandCenterSrc = "/command-center/Command%20Center.html?v=20260619b";
  return (
    <iframe
      title="Openflow Command Center"
      src={commandCenterSrc}
      style={{
        width: "100vw",
        height: "100vh",
        border: "0",
        display: "block"
      }}
    />
  );
}
