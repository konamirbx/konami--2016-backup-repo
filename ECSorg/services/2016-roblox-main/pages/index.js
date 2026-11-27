import { useEffect } from "react"
import AuthenticationStore from "../stores/authentication"

const IndexPage = props => {
  const auth = AuthenticationStore.useContainer();
  useEffect(() => {
    if (auth.isPending) return;
    window.location.replace(auth.isAuthenticated ? '/home' : '/auth/login');
  }, [auth.isAuthenticated, auth.isPending]);

  return <div className="container mt-4 text-center">Loading account...</div>;
}

export default IndexPage;