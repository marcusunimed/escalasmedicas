const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Arquivo para armazenar os dados
const DATA_FILE = 'medical_schedule_data.json';

// Função para ler dados do arquivo
async function readData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Se o arquivo não existir, retornar dados vazios
        return { medicalSchedule: {}, lastUpdated: new Date().toISOString() };
    }
}

// Função para salvar dados no arquivo
async function saveData(data) {
    data.lastUpdated = new Date().toISOString();
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Rota para obter todos os dados da escala
app.get('/api/schedule', async (req, res) => {
    try {
        const data = await readData();
        res.json({
            success: true,
            data: data.medicalSchedule,
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar dados',
            error: error.message
        });
    }
});

// Rota para salvar/atualizar uma escala específica
app.post('/api/schedule', async (req, res) => {
    try {
        const { officeId, day, timeSlot, doctorData } = req.body;
        
        // Validação básica
        if (!officeId || !day || !timeSlot || !doctorData) {
            return res.status(400).json({
                success: false,
                message: 'Dados incompletos'
            });
        }

        const data = await readData();
        
        // Inicializar estrutura se não existir
        if (!data.medicalSchedule[officeId]) {
            data.medicalSchedule[officeId] = {};
        }
        if (!data.medicalSchedule[officeId][day]) {
            data.medicalSchedule[officeId][day] = {};
        }

        // Salvar os dados
        data.medicalSchedule[officeId][day][timeSlot] = doctorData;

        await saveData(data);

        res.json({
            success: true,
            message: 'Escala salva com sucesso',
            data: data.medicalSchedule[officeId][day][timeSlot]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro ao salvar dados',
            error: error.message
        });
    }
});

// Rota para excluir uma escala específica
app.delete('/api/schedule/:officeId/:day/:timeSlot', async (req, res) => {
    try {
        const { officeId, day, timeSlot } = req.params;
        
        const data = await readData();
        
        if (data.medicalSchedule[officeId] && 
            data.medicalSchedule[officeId][day] && 
            data.medicalSchedule[officeId][day][timeSlot]) {
            
            delete data.medicalSchedule[officeId][day][timeSlot];
            
            // Limpar objetos vazios
            if (Object.keys(data.medicalSchedule[officeId][day]).length === 0) {
                delete data.medicalSchedule[officeId][day];
            }
            
            await saveData(data);
            
            res.json({
                success: true,
                message: 'Escala excluída com sucesso'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Escala não encontrada'
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro ao excluir dados',
            error: error.message
        });
    }
});

// Rota para buscar médicos
app.get('/api/search/doctor', async (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name || name.length < 2) {
            return res.json({
                success: true,
                results: []
            });
        }
        
        const data = await readData();
        const foundDoctors = {};
        
        // Buscar médicos na escala
        for (const officeId in data.medicalSchedule) {
            for (const day in data.medicalSchedule[officeId]) {
                for (const time in data.medicalSchedule[officeId][day]) {
                    const doctor = data.medicalSchedule[officeId][day][time];
                    if (doctor.name && doctor.name.toLowerCase().includes(name.toLowerCase())) {
                        if (!foundDoctors[doctor.name]) {
                            foundDoctors[doctor.name] = {
                                schedules: [],
                                specialty: getSpecialtyFromOfficeId(officeId)
                            };
                        }
                        foundDoctors[doctor.name].schedules.push({
                            office: officeId,
                            day: day,
                            time: time,
                            hours: doctor.hours || '',
                            type: doctor.type,
                            note: doctor.note || ''
                        });
                    }
                }
            }
        }
        
        res.json({
            success: true,
            results: foundDoctors
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro na busca',
            error: error.message
        });
    }
});

// Rota para backup dos dados
app.get('/api/backup', async (req, res) => {
    try {
        const data = await readData();
        
        // Criar nome do arquivo com data
        const date = new Date().toISOString().split('T')[0];
        const filename = `backup_escalas_${date}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(data, null, 2));

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro ao gerar backup',
            error: error.message
        });
    }
});

// Rota para restaurar backup
app.post('/api/restore', async (req, res) => {
    try {
        const backupData = req.body;
        
        // Validar estrutura do backup
        if (!backupData.medicalSchedule) {
            return res.status(400).json({
                success: false,
                message: 'Arquivo de backup inválido'
            });
        }
        
        await saveData(backupData);
        
        res.json({
            success: true,
            message: 'Backup restaurado com sucesso'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erro ao restaurar backup',
            error: error.message
        });
    }
});

// Função auxiliar para obter especialidade do ID do consultório
function getSpecialtyFromOfficeId(officeId) {
    const prefix = officeId.split('_')[0];
    const specialtyMap = {
        'derm': 'dermatologia',
        'card': 'cardiologia',
        'oftal': 'oftalmologia',
        'ped': 'pediatria',
        'gine': 'ginecologia',
        'psiq': 'psiquiatria'
    };
    return specialtyMap[prefix] || 'geral';
}

// Rota de teste
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Backend funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Servir o arquivo HTML principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar servidor
app.listen(PORT, () => {
    console.log(`🏥 Servidor rodando na porta ${PORT}`);
    console.log(`📋 Acesse: http://localhost:${PORT}`);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promise rejeitada:', error);
});