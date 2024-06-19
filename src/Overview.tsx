import { Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

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
        <>
        <Typography>Works</Typography>
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 'bold'}}>Title</TableCell>
                        <TableCell sx={{ fontWeight: 'bold'}}>Sources</TableCell>
                        <TableCell sx={{ fontWeight: 'bold'}}>Encoder</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                {works.map(work => {
                    return (
                        <TableRow key={`workItem_${work.id}`}>
                            <TableCell><Link to={work.id}>{work.title}</Link></TableCell>
                            <TableCell>{work.sources.map(s => s.siglum).join('| ')}</TableCell>
                            <TableCell>{work.encoder}</TableCell>
                        </TableRow>
                    )
                })}
                </TableBody>
            </Table>
        </>
    )
}
