import { Container, Stack } from "@mui/material"
import { Overview } from "./Overview"
import { Header } from "./Header"
import { About } from "./About"

const App = () => {
  return (
    <Container maxWidth='md'>
      <Header />

      <Stack spacing={2}>
        <About />
        <Overview />
      </Stack>
    </Container>
  )
}

export default App 
