/*
  Arquivo: server.js
  Descrição: Este arquivo configura e executa o servidor backend da aplicação Calculadora de Craft Pokexgames.
  Ele utiliza Express.js para roteamento e manipulação de requisições HTTP, e SQLite como banco de dados
  para persistir as receitas dos itens. O servidor expõe uma API RESTful para operações CRUD (Create, Read,
  Update, Delete) sobre as receitas.
  Principais Funcionalidades:
  - Conexão e Inicialização do Banco de Dados: Estabelece a conexão com o arquivo de banco de dados SQLite
    (criando-o se não existir) e executa um schema SQL (`schema.sql`) para garantir que as tabelas
    necessárias (`recipes` e `recipe_materials`) estejam presentes.
  - Middlewares: Utiliza `cors` para permitir requisições de diferentes origens (Cross-Origin Resource Sharing)
    e `express.json()` para parsear corpos de requisição no formato JSON.
  - Rotas da API:
    - GET /api/items: Retorna uma lista de todos os itens craftáveis. Crucialmente, esta rota foi
                      modificada para também incluir os materiais associados a cada item na resposta,
                      evitando a necessidade de múltiplas chamadas da API pelo frontend para obter
                      esta informação.
    - GET /api/items/:id/recipe: Retorna os detalhes completos de uma receita específica, incluindo seus materiais.
    - GET /api/items/name/:name: Busca um item pelo nome (usado para obter o preço NPC, por exemplo).
    - POST /api/items: Cria uma nova receita de item, incluindo seus materiais, no banco de dados.
                       Utiliza transações para garantir a atomicidade da operação.
    - PUT /api/items/:id: Atualiza uma receita de item existente e seus materiais.
                          Também utiliza transações.
    - DELETE /api/items/:id: Remove uma receita de item do banco de dados.
    - GET /health: Uma rota simples para verificar a saúde do servidor.
  - Tratamento de Erro: Um middleware genérico para capturar e responder a erros não tratados.
  - Inicialização do Servidor: Inicia o servidor Express para escutar na porta configurada (padrão 3000).
  Dependências:
  - express: Framework web para Node.js.
  - sqlite3: Driver para interagir com o banco de dados SQLite.
  - cors: Middleware para habilitar CORS.
  - path, fs: Módulos nativos do Node.js para manipulação de caminhos de arquivo e sistema de arquivos.
*/
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const dbBasePath = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(__dirname, 'database.db');
console.log(`[DB Init] Arquivo do banco de dados será salvo em: ${DB_FILE}`);

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Erro ao conectar ao banco de dados SQLite:", err.message);
        return;
    }
    console.log("Conectado ao banco de dados SQLite.");

    fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8', (err, sql) => {
        if (err) {
            console.error("Erro ao ler o arquivo schema.sql:", err);
            return;
        }
        db.exec(sql, (err) => {
            if (err) {
                console.error("Erro ao executar o schema SQL:", err.message);
            } else {
                console.log("Schema do banco de dados garantido.");
            }
        });
    });
});

app.use(cors());
app.use(express.json());

app.get('/api/items', (req, res) => {
    const sqlRecipes = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes ORDER BY name ASC";
    const sqlMaterials = "SELECT recipe_id, material_name, quantity, material_type, default_npc_price FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) {
            console.error("Erro na query GET /api/items (recipes):", err.message);
            res.status(500).json({ error: 'Erro interno do servidor ao buscar itens.' });
            return;
        }

        if (!recipes || recipes.length === 0) {
            res.json([]);
            return;
        }

        db.all(sqlMaterials, [], (err, materials) => {
            if (err) {
                console.error("Erro na query GET /api/items (materials):", err.message);
                res.status(500).json({ error: 'Erro interno do servidor ao buscar materiais dos itens.' });
                return;
            }

            const itemsWithMaterials = recipes.map(recipe => {
                return {
                    ...recipe,
                    materials: materials.filter(material => material.recipe_id === recipe.id)
                                     .map(({ recipe_id, ...rest }) => rest)
                };
            });
            res.json(itemsWithMaterials);
        });
    });
});

app.get('/api/items/:id/recipe', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }

    const sqlRecipe = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes WHERE id = ?";
    const sqlMaterials = "SELECT material_name, quantity, material_type, default_npc_price FROM recipe_materials WHERE recipe_id = ?";

    db.get(sqlRecipe, [itemId], (err, recipeRow) => {
        if (err) {
            console.error(`Erro na query de receita para ID ${itemId}:`, err.message);
            return res.status(500).json({ error: 'Erro interno do servidor ao buscar receita.' });
        }
        if (!recipeRow) { return res.status(404).json({ error: 'Item não encontrado.' }); }

        db.all(sqlMaterials, [itemId], (err, materialRows) => {
            if (err) {
                console.error(`Erro na query de materiais para ID ${itemId}:`, err.message);
                return res.status(500).json({ error: 'Erro interno do servidor ao buscar materiais da receita.' });
            }
            const fullRecipe = { ...recipeRow, materials: materialRows || [] };
            res.json(fullRecipe);
        });
    });
});

app.get('/api/items/name/:name', (req, res) => {
    const itemName = req.params.name;
    const sql = "SELECT npc_sell_price FROM recipes WHERE name = ?";
    db.get(sql, [itemName], (err, row) => {
        if (err) {
            console.error("Erro ao buscar item por nome:", err.message);
            return res.status(500).json({ error: 'Erro ao buscar item.' });
        }
        if (row) {
            return res.json({ npc_sell_price: row.npc_sell_price });
        } else {
            return res.status(404).json({ message: 'Item não encontrado.' });
        }
    });
   });

app.post('/api/items', (req, res) => {
    const { name, quantity_produced, npc_sell_price, materials } = req.body;

    if (!name || !quantity_produced || !materials || !Array.isArray(materials)) { return res.status(400).json({ error: 'Dados inválidos para criar item.' }); }
    if (materials.some(mat => !mat.material_name || !mat.quantity || !mat.material_type)) { return res.status(400).json({ error: 'Dados inválidos em um ou mais materiais.' }); }

    const sqlInsertRecipe = `INSERT INTO recipes (name, quantity_produced, npc_sell_price) VALUES (?, ?, ?)`;
    const sqlInsertMaterial = `INSERT INTO recipe_materials (recipe_id, material_name, quantity, material_type, default_npc_price) VALUES (?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let recipeId = null;
        db.run(sqlInsertRecipe, [name, quantity_produced, npc_sell_price || 0], function(err) {
            if (err) {
                console.error("Erro ao inserir receita:", err.message);
                db.run('ROLLBACK');
                return res.status(500).json({ error: `Erro ao salvar receita: ${err.message}` });
            }
            recipeId = this.lastID;

            const stmtMaterial = db.prepare(sqlInsertMaterial);
            let materialErrorOccurred = false;
            materials.forEach(mat => {
                if (materialErrorOccurred) return;
                stmtMaterial.run([recipeId, mat.material_name, mat.quantity, mat.material_type, mat.default_npc_price || 0], (runErr) => {
                    if (runErr) { console.error("Erro ao inserir material:", runErr.message); materialErrorOccurred = true; }
                });
            });
            stmtMaterial.finalize((finalizeErr) => {
                 if (finalizeErr) { console.error("Erro ao finalizar statement de material:", finalizeErr.message); materialErrorOccurred = true; }
                 if (materialErrorOccurred) {
                    db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao salvar um ou mais materiais.' });
                 } else {
                    db.run('COMMIT'); return res.status(201).json({ message: 'Receita criada com sucesso!', id: recipeId });
                 }
            });
        });
    });
});

app.put('/api/items/:id', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    const { name, quantity_produced, npc_sell_price, materials } = req.body;

    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }
    if (!name || !quantity_produced || !materials || !Array.isArray(materials)) { return res.status(400).json({ error: 'Dados inválidos para atualizar item.' }); }
    if (materials.some(mat => !mat.material_name || !mat.quantity || !mat.material_type)) { return res.status(400).json({ error: 'Dados inválidos em um ou mais materiais.' }); }

    const sqlUpdateRecipe = `UPDATE recipes SET name = ?, quantity_produced = ?, npc_sell_price = ? WHERE id = ?`;
    const sqlDeleteMaterials = `DELETE FROM recipe_materials WHERE recipe_id = ?`;
    const sqlInsertMaterial = `INSERT INTO recipe_materials (recipe_id, material_name, quantity, material_type, default_npc_price) VALUES (?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        db.run(sqlUpdateRecipe, [name, quantity_produced, npc_sell_price || 0, itemId], function(err) {
            if (err) { errorOccurred = true; console.error("Erro ao atualizar receita:", err.message); db.run('ROLLBACK'); return res.status(500).json({ error: `Erro ao atualizar receita: ${err.message}` }); }
            if (this.changes === 0 && !errorOccurred) { errorOccurred = true; db.run('ROLLBACK'); return res.status(404).json({ error: 'Item não encontrado para atualização.' }); }

            if(!errorOccurred) {
                db.run(sqlDeleteMaterials, [itemId], (deleteErr) => {
                    if (deleteErr) { errorOccurred = true; console.error("Erro ao deletar materiais antigos:", deleteErr.message); db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao limpar materiais antigos.' }); }

                    if (!errorOccurred) {
                        const stmtMaterial = db.prepare(sqlInsertMaterial);
                        let materialInsertError = false;
                        materials.forEach(mat => {
                            if (materialInsertError) return;
                            stmtMaterial.run([itemId, mat.material_name, mat.quantity, mat.material_type, mat.default_npc_price || 0], (runErr) => { if (runErr) { console.error("Erro ao inserir novo material:", runErr.message); materialInsertError = true; } });
                        });
                        stmtMaterial.finalize((finalizeErr) => {
                            if (finalizeErr) { console.error("Erro ao finalizar statement de material (update):", finalizeErr.message); materialInsertError = true; }
                            if (materialInsertError) { errorOccurred = true; db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao salvar um ou mais materiais atualizados.' }); }
                            else if (!errorOccurred) { db.run('COMMIT'); return res.json({ message: 'Receita atualizada com sucesso!', id: itemId }); }
                        });
                    }
                });
            }
        });
    });
});

app.delete('/api/items/:id', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }
    const sql = `DELETE FROM recipes WHERE id = ?`;
    db.run(sql, [itemId], function(err) {
        if (err) { console.error("Erro ao deletar receita:", err.message); return res.status(500).json({ error: `Erro ao deletar receita: ${err.message}` }); }
        if (this.changes === 0) { return res.status(404).json({ error: 'Item não encontrado para deletar.' }); }
        res.status(200).json({ message: 'Receita deletada com sucesso!' });
    });
});

app.use((err, req, res, next) => {
    console.error("Erro não tratado:", err.stack);
    res.status(500).json({ error: 'Algo deu muito errado no servidor!' });
});

app.get('/health', (req, res) => {
    console.log("[GET /health] Ping received.");
    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`Servidor backend rodando na porta ${PORT}`);
    console.log(`API disponível em http://localhost:${PORT}/api`);
});