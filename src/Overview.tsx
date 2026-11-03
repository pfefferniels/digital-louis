import { Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import './Overview.css'

/** The table reads at a smaller size on a phone, where three columns share little room. */
const cell = { fontSize: { xs: 16, sm: 20 }, px: { xs: 1, sm: 2 } }
const headCell = { ...cell, fontWeight: 'bold' }

interface SourceInfo {
    siglum: string
    svg: string | null
}

export interface WorkInfo {
    id: string
    title: string
    sources: SourceInfo[]
    encoder: string
}

const encodings = ['prelude7.mei', 'prelude10.mei']

export const Overview = () => {
    const [works, setWorks] = useState<WorkInfo[]>([])

    useEffect(() => {
        const parser = new DOMParser()

        const loadEncodings = async () => {
            const newWorks: WorkInfo[] = []
            for (const encoding of encodings) {
                const resp = await fetch(encoding)
                const text = await resp.text()
                const doc = parser.parseFromString(text, 'text/xml')
                newWorks.push({
                    id: encoding.replace('.mei', ''),
                    title: doc.querySelector('titleStmt title')?.textContent || 'unknown',
                    sources: [...doc.querySelectorAll('sourceDesc source')].map(e => {
                        return {
                            siglum: e.textContent || '',
                            svg: e.getAttribute('target')
                        }
                    }),
                    encoder: doc.querySelector('persName[role="encoder"]')?.textContent || 'unknown'
                })
            }
            setWorks(newWorks)
        }

        loadEncodings()
    }, [])

    return (
        <div className="worksList">
            <Table>
                <TableHead>
                    <TableRow >
                        <TableCell sx={headCell}>Title</TableCell>
                        <TableCell sx={headCell}>Sources</TableCell>
                        <TableCell sx={headCell}>Encoder</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {works.map(work => {
                        return (
                            <TableRow key={`workItem_${work.id}`}>
                                <TableCell sx={cell}><Link to={work.id}>{work.title}</Link></TableCell>
                                <TableCell sx={cell}>{work.sources.map(s => s.siglum).join('| ')}</TableCell>
                                <TableCell sx={cell}>{work.encoder}</TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    )
}
