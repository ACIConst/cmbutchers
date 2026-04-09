import OperatorGate from "../components/OperatorGate";
import { AuthProvider } from "../context/AuthContext";
import AdminView from "../views/admin/AdminView";

export default function AdminRoute({ initialTab }) {
  return (
    <AuthProvider>
      <OperatorGate>
        <AdminView initialTab={initialTab} />
      </OperatorGate>
    </AuthProvider>
  );
}
