/*
  Arquivo: server.js
  Descrição: Este arquivo configura e executa o servidor backend da aplicação Calculadora de Craft Pokexgames.
  Ele utiliza Express.js para roteamento e manipulação de requisições HTTP, e SQLite como banco de dados
  para persistir as receitas dos itens. O servidor expõe uma API RESTful para operações CRUD (Create, Read,
  Update, Delete) sobre as receitas, além de rotas analíticas.
  Principais Funcionalidades:
  - Conexão e Inicialização do Banco de Dados: Estabelece a conexão com o arquivo de banco de dados SQLite
    (criando-o se não existir) e executa um schema SQL (`schema.sql`) para garantir que as tabelas
    necessárias (`recipes` e `recipe_materials`) estejam presentes.
  - Middlewares: Utiliza `cors` para permitir requisições de diferentes origens (Cross-Origin Resource Sharing)
    e `express.json()` para parsear corpos de requisição no formato JSON.
  - Rotas da API:
    - GET /api/items: Retorna uma lista de todos os itens craftáveis, incluindo seus materiais.
    - GET /api/items/:id/recipe: Retorna os detalhes completos de uma receita específica, incluindo seus materiais.
    - GET /api/items/name/:name: Busca um item pelo nome e retorna seu preço NPC.
    - POST /api/items: Cria uma nova receita de item.
    - PUT /api/items/:id: Atualiza uma receita de item existente.
    - DELETE /api/items/:id: Remove uma receita de item.
    - GET /api/items/by-material: Retorna itens que usam um material específico.
    - GET /api/items/most-profitable-npc: Retorna itens ordenados por lucratividade considerando apenas preços NPC.
    - GET /api/items/filter-by-material-profile: Filtra itens com base no perfil de tipo de seus materiais.
    - GET /api/materials/usage-summary: Fornece um sumário do uso de materiais, podendo incluir preço NPC para consultas específicas.
    - POST /api/crafting/check-possibilities: Verifica quais itens podem ser fabricados com base nos materiais fornecidos pelo usuário.
    - POST /api/crafting/analyze-potential-crafts: Analisa receitas que usam os materiais fornecidos, detalhando materiais faltantes e crafts possíveis.
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
    const sql = "SELECT npc_sell_price FROM recipes WHERE LOWER(name) = LOWER(?)";
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

app.get('/api/items/by-material', (req, res) => {
    const materialName = req.query.materialName;
    if (!materialName) {
        return res.status(400).json({ error: 'Nome do material é obrigatório na query string (materialName).' });
    }
    const sqlRecipes = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes ORDER BY name ASC";
    const sqlMaterials = "SELECT recipe_id, material_name, quantity, material_type, default_npc_price FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) {
            console.error("Erro na query GET /api/items/by-material (recipes):", err.message);
            return res.status(500).json({ error: 'Erro interno do servidor ao buscar itens.' });
        }
        if (!recipes || recipes.length === 0) { return res.json([]); }
        db.all(sqlMaterials, [], (err, materials) => {
            if (err) {
                console.error("Erro na query GET /api/items/by-material (materials):", err.message);
                return res.status(500).json({ error: 'Erro interno do servidor ao buscar materiais.' });
            }
            const recipesUsingMaterial = recipes.filter(recipe => {
                const recipeMaterials = materials.filter(m => m.recipe_id === recipe.id);
                return recipeMaterials.some(m => m.material_name.toLowerCase() === materialName.toLowerCase());
            }).map(recipe => {
                return {
                    ...recipe,
                    materials: materials.filter(material => material.recipe_id === recipe.id)
                                     .map(({ recipe_id, ...rest }) => rest)
                };
            });
            res.json(recipesUsingMaterial);
        });
    });
});

app.get('/api/items/most-profitable-npc', (req, res) => {
    const sqlRecipes = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes";
    const sqlMaterials = "SELECT recipe_id, material_name, quantity, material_type, default_npc_price FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) {
            console.error("Erro na query GET /api/items/most-profitable-npc (recipes):", err.message);
            return res.status(500).json({ error: 'Erro interno do servidor ao buscar itens para cálculo de lucro.' });
        }
        if (!recipes || recipes.length === 0) { return res.json([]); }
        db.all(sqlMaterials, [], (err, materials) => {
            if (err) {
                console.error("Erro na query GET /api/items/most-profitable-npc (materials):", err.message);
                return res.status(500).json({ error: 'Erro interno do servidor ao buscar materiais para cálculo de lucro.' });
            }
            const profitableItems = recipes.map(recipe => {
                const recipeMaterials = materials.filter(m => m.recipe_id === recipe.id);
                let totalMaterialCostNpc = 0;
                for (const mat of recipeMaterials) {
                    if (mat.material_type === 'profession') { continue; }
                    totalMaterialCostNpc += (mat.quantity * (mat.default_npc_price || 0));
                }
                const totalRevenueNpc = (recipe.npc_sell_price || 0) * (recipe.quantity_produced || 1);
                const profitNpc = totalRevenueNpc - totalMaterialCostNpc;
                return {
                    id: recipe.id,
                    name: recipe.name,
                    quantity_produced: recipe.quantity_produced,
                    npc_sell_price_per_unit: recipe.npc_sell_price,
                    total_revenue_npc: totalRevenueNpc,
                    total_material_cost_npc: totalMaterialCostNpc,
                    profit_npc: profitNpc,
                };
            }).sort((a, b) => b.profit_npc - a.profit_npc);
            res.json(profitableItems);
        });
    });
});

app.get('/api/items/filter-by-material-profile', (req, res) => {
    const { materialTypes: materialTypesQuery, matchProfile = 'exclusive' } = req.query;

    if (!materialTypesQuery) {
        return res.status(400).json({ error: 'O parâmetro "materialTypes" é obrigatório (ex: "profession" ou "drop,buy").' });
    }
    const validProfiles = ['exclusive', 'contains_any', 'contains_all', 'not_contains_any'];
    if (!validProfiles.includes(matchProfile)) {
        return res.status(400).json({ error: `Valor inválido para "matchProfile". Válidos: ${validProfiles.join(', ')}.` });
    }
    const typesArray = materialTypesQuery.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
    if (typesArray.length === 0) {
         return res.status(400).json({ error: 'Nenhum tipo de material válido fornecido em "materialTypes".' });
    }

    const sqlRecipes = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes ORDER BY name ASC";
    const sqlMaterials = "SELECT recipe_id, material_name, quantity, material_type, default_npc_price FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) { return res.status(500).json({ error: 'Erro ao buscar receitas.' }); }
        if (!recipes || recipes.length === 0) { return res.json([]); }

        db.all(sqlMaterials, [], (err, materials) => {
            if (err) { return res.status(500).json({ error: 'Erro ao buscar materiais.' }); }

            const filteredRecipes = recipes.filter(recipe => {
                const recipeMats = materials.filter(m => m.recipe_id === recipe.id);
                if (recipeMats.length === 0 && (matchProfile === 'exclusive' || matchProfile === 'not_contains_any')) {
                    return matchProfile === 'not_contains_any';
                }
                 if (recipeMats.length === 0) return false;

                switch (matchProfile) {
                    case 'exclusive':
                        return recipeMats.every(m => typesArray.includes(m.material_type.toLowerCase()));
                    case 'contains_any':
                        return recipeMats.some(m => typesArray.includes(m.material_type.toLowerCase()));
                    case 'contains_all':
                        return typesArray.every(type => recipeMats.some(m => m.material_type.toLowerCase() === type));
                    case 'not_contains_any':
                        return !recipeMats.some(m => typesArray.includes(m.material_type.toLowerCase()));
                    default:
                        return false;
                }
            }).map(recipe => ({
                ...recipe,
                materials: materials.filter(material => material.recipe_id === recipe.id)
                                 .map(({ recipe_id, ...rest }) => rest)
            }));
            res.json(filteredRecipes);
        });
    });
});

app.get('/api/materials/usage-summary', (req, res) => {
    const { materialName: materialNameQuery, materialTypes: materialTypesQuery } = req.query;

    let baseSql = "SELECT material_name, material_type, SUM(quantity) as total_quantity_needed, COUNT(DISTINCT recipe_id) as used_in_recipes_count";
    let priceColumn = "";
    const conditions = [];
    const params = [];

    if (materialNameQuery) {
        conditions.push("LOWER(material_name) LIKE LOWER(?)");
        params.push(`%${materialNameQuery}%`);
        // Tenta adicionar o preço NPC se um nome específico for consultado.
        // Pega o MAX pois deve ser consistente; se houver variações, isso pode não ser ideal, mas é uma aproximação.
        priceColumn = ", (SELECT MAX(rm_price.default_npc_price) FROM recipe_materials rm_price WHERE LOWER(rm_price.material_name) = LOWER(recipe_materials.material_name) AND rm_price.material_type = recipe_materials.material_type AND rm_price.material_type != 'profession') as default_npc_price";
    }
    
    baseSql = `SELECT material_name, material_type, SUM(quantity) as total_quantity_needed, COUNT(DISTINCT recipe_id) as used_in_recipes_count ${priceColumn} FROM recipe_materials`;

    if (materialTypesQuery) {
        const typesArray = materialTypesQuery.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
        if (typesArray.length > 0) {
            conditions.push(`material_type IN (${typesArray.map(() => '?').join(',')})`);
            params.push(...typesArray);
        }
    }

    if (conditions.length > 0) {
        baseSql += " WHERE " + conditions.join(" AND ");
    }
    baseSql += " GROUP BY material_name, material_type";
    if(materialNameQuery) { // Se estamos pegando preço, precisamos agrupar por ele também se ele for fixo por material+tipo
         // No entanto, a subquery para o preço já o torna único por material_name e material_type,
         // então o GROUP BY principal não precisa incluir explicitamente default_npc_price se ele vier da subquery.
         // Se default_npc_price fosse uma coluna direta e não agregada, seria necessário no GROUP BY.
         // Como está na subquery, o GROUP BY material_name, material_type é suficiente.
    }
    baseSql += " ORDER BY used_in_recipes_count DESC, total_quantity_needed DESC, material_name ASC";

    db.all(baseSql, params, (err, rows) => {
        if (err) {
            console.error("Erro na query GET /api/materials/usage-summary:", err.message);
            return res.status(500).json({ error: 'Erro interno do servidor ao buscar sumário de materiais.' });
        }
        res.json(rows);
    });
});

app.post('/api/crafting/check-possibilities', (req, res) => {
    const { availableMaterials } = req.body;

    if (!availableMaterials || !Array.isArray(availableMaterials)) {
        return res.status(400).json({ error: 'O corpo da requisição deve conter um array "availableMaterials".' });
    }

    const userInventory = availableMaterials.reduce((acc, mat) => {
        if (mat.material_name && typeof mat.quantity === 'number' && mat.quantity >= 0) {
            acc[mat.material_name.toLowerCase()] = (acc[mat.material_name.toLowerCase()] || 0) + mat.quantity;
        }
        return acc;
    }, {});

    if (Object.keys(userInventory).length === 0 && availableMaterials.length > 0 ) {
        return res.status(400).json({ error: 'Nenhum material válido fornecido em "availableMaterials". Cada material deve ter "material_name" e "quantity".' });
    }

    const sqlRecipes = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes";
    const sqlAllRecipeMaterials = "SELECT recipe_id, material_name, quantity FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) { return res.status(500).json({ error: 'Erro ao buscar receitas para verificar possibilidades.' }); }
        if (!recipes || recipes.length === 0) { return res.json([]); }

        db.all(sqlAllRecipeMaterials, [], (err, allMaterials) => {
            if (err) { return res.status(500).json({ error: 'Erro ao buscar materiais de receita para verificar possibilidades.' }); }

            const craftableItems = [];

            recipes.forEach(recipe => {
                const materialsNeededForRecipe = allMaterials.filter(m => m.recipe_id === recipe.id);

                if (materialsNeededForRecipe.length === 0) {
                    craftableItems.push({
                        recipe_id: recipe.id,
                        recipe_name: recipe.name,
                        quantity_produced_per_craft: recipe.quantity_produced,
                        max_crafts_possible: Infinity, 
                        materials_needed: []
                    });
                    return; 
                }

                let canCraftRecipe = true;
                let maxCraftsForThisRecipe = Infinity;

                for (const neededMat of materialsNeededForRecipe) {
                    const userHasQty = userInventory[neededMat.material_name.toLowerCase()] || 0;
                    const neededQtyPerCraft = neededMat.quantity;

                    if (userHasQty < neededQtyPerCraft) {
                        canCraftRecipe = false;
                        maxCraftsForThisRecipe = 0; 
                        break; 
                    }
                    const possibleCraftsWithThisMaterial = Math.floor(userHasQty / neededQtyPerCraft);
                    if (possibleCraftsWithThisMaterial < maxCraftsForThisRecipe) {
                        maxCraftsForThisRecipe = possibleCraftsWithThisMaterial;
                    }
                }

                if (canCraftRecipe && maxCraftsForThisRecipe > 0 && maxCraftsForThisRecipe !== Infinity) {
                    craftableItems.push({
                        recipe_id: recipe.id,
                        recipe_name: recipe.name,
                        quantity_produced_per_craft: recipe.quantity_produced,
                        max_crafts_possible: maxCraftsForThisRecipe,
                        total_items_producible: maxCraftsForThisRecipe * recipe.quantity_produced,
                        materials_needed: materialsNeededForRecipe.map(m => ({
                            material_name: m.material_name,
                            quantity_per_craft: m.quantity,
                            total_quantity_needed_for_max_crafts: m.quantity * maxCraftsForThisRecipe,
                            user_has_quantity: userInventory[m.material_name.toLowerCase()] || 0
                        }))
                    });
                }
            });

            res.json(craftableItems.sort((a,b) => b.max_crafts_possible - a.max_crafts_possible));
        });
    });
});

app.post('/api/crafting/analyze-potential-crafts', (req, res) => {
    const { userMaterials } = req.body;

    if (!userMaterials || !Array.isArray(userMaterials)) {
        return res.status(400).json({ error: 'O corpo da requisição deve conter um array "userMaterials".' });
    }

    const userInventory = userMaterials.reduce((acc, mat) => {
        if (mat.material_name && typeof mat.quantity === 'number' && mat.quantity >= 0) {
            acc[mat.material_name.toLowerCase()] = (acc[mat.material_name.toLowerCase()] || 0) + mat.quantity;
        }
        return acc;
    }, {});

    if (Object.keys(userInventory).length === 0 && userMaterials.length > 0) {
         return res.status(400).json({ error: 'Nenhum material válido fornecido em "userMaterials". Cada material deve ter "material_name" e "quantity".' });
    }

    const sqlRecipes = "SELECT id, name, quantity_produced FROM recipes";
    const sqlAllRecipeMaterials = "SELECT recipe_id, material_name, quantity, material_type FROM recipe_materials";

    db.all(sqlRecipes, [], (err, recipes) => {
        if (err) { return res.status(500).json({ error: 'Erro ao buscar receitas para análise.' }); }
        if (!recipes || recipes.length === 0) { return res.json([]); }

        db.all(sqlAllRecipeMaterials, [], (err, allMaterials) => {
            if (err) { return res.status(500).json({ error: 'Erro ao buscar materiais de receita para análise.' }); }

            const analysisResults = [];

            recipes.forEach(recipe => {
                const materialsNeededForThisRecipe = allMaterials.filter(m => m.recipe_id === recipe.id);
                
                let recipeUsesAnyUserMaterial = false;
                if (Object.keys(userInventory).length > 0) {
                    recipeUsesAnyUserMaterial = materialsNeededForThisRecipe.some(neededMat => 
                        userInventory.hasOwnProperty(neededMat.material_name.toLowerCase())
                    );
                } else { // Se userMaterials for um array vazio, analisar todas as receitas
                    recipeUsesAnyUserMaterial = true;
                }

                if (!recipeUsesAnyUserMaterial && Object.keys(userInventory).length > 0) { // Não mostrar se usuário especificou materiais e esta receita não usa nenhum deles
                    return; 
                }
                
                let craftableNowCount = Infinity;
                let canCraftAnyWithCurrentMaterials = true;

                const materialsAnalysis = materialsNeededForThisRecipe.map(neededMat => {
                    const userHasQty = userInventory[neededMat.material_name.toLowerCase()] || 0;
                    const quantityMissingForOneCraft = Math.max(0, neededMat.quantity - userHasQty);
                    
                    if (userHasQty < neededMat.quantity) {
                        canCraftAnyWithCurrentMaterials = false;
                    }
                    if (neededMat.quantity > 0) { // Evitar divisão por zero
                         const possibleCraftsWithThisMaterial = Math.floor(userHasQty / neededMat.quantity);
                         if (possibleCraftsWithThisMaterial < craftableNowCount) {
                             craftableNowCount = possibleCraftsWithThisMaterial;
                         }
                    } else if (neededMat.quantity === 0) { // Se a receita pede 0 de um material, não limita
                        // craftableNowCount permanece como estava
                    }
                    return {
                        material_name: neededMat.material_name,
                        material_type: neededMat.material_type,
                        quantity_needed_per_craft: neededMat.quantity,
                        user_has_quantity: userHasQty,
                        quantity_missing_for_one_craft: quantityMissingForOneCraft,
                    };
                });
                
                if (!canCraftAnyWithCurrentMaterials) {
                    craftableNowCount = 0;
                } else if (materialsNeededForThisRecipe.length === 0) { // Receita sem materiais
                    craftableNowCount = Infinity;
                } else if (craftableNowCount === Infinity && materialsNeededForThisRecipe.length > 0 && canCraftAnyWithCurrentMaterials) {
                    // Se todos os materiais necessários têm quantidade 0 na receita, ou se o usuário tem "infinito" de todos.
                    // Mais provável, se a receita tem materiais com quantidade > 0, craftableNowCount já teria um valor numérico.
                    // Se chegou aqui como Infinity, e pode craftar (canCraftAnyWithCurrentMaterials), mas tem materiais,
                    // isso indica um cenário onde as quantidades na receita são 0, ou algo não limitou.
                    // Se a receita REALMENTE não tem materiais que limitam (ex: todos os mats da receita têm qtd 0), aí é Infinity.
                    // Vamos assumir que, se tem materiais e pode craftar, mas não foi limitado, é ao menos 1 se todas as quantidades são 0 na receita
                    // Mas o mais seguro é que se tem materiais e pode craftar, já deveria ter sido calculado.
                    // Se ainda for Infinity, e tem materiais, é porque nenhum material foi um gargalo (quantidades na receita eram 0 ou o usuário tinha muito)
                    // Para evitar Infinity real, se pode craftar e tem materiais, mas continua Infinity, significa que o gargalo não foi encontrado, o que pode ser 0 se as quantidades da receita forem >0
                    // A lógica original de check-possibilities é mais direta para "craftableNowCount".
                    // Replicando-a para este caso específico:
                    if (materialsNeededForThisRecipe.length > 0) {
                        let tempMaxCrafts = Infinity;
                        for (const neededMat of materialsNeededForThisRecipe) {
                            const userHasQty = userInventory[neededMat.material_name.toLowerCase()] || 0;
                            if (userHasQty < neededMat.quantity) { tempMaxCrafts = 0; break; }
                            if (neededMat.quantity > 0) {
                                tempMaxCrafts = Math.min(tempMaxCrafts, Math.floor(userHasQty / neededMat.quantity));
                            }
                        }
                        craftableNowCount = (tempMaxCrafts === Infinity && materialsNeededForThisRecipe.length > 0) ? 0 : tempMaxCrafts;
                    } else {
                        craftableNowCount = Infinity;
                    }
                }


                analysisResults.push({
                    recipe_id: recipe.id,
                    recipe_name: recipe.name,
                    quantity_produced_per_craft: recipe.quantity_produced,
                    materials_analysis: materialsAnalysis,
                    craftable_now_count: craftableNowCount
                });
            });
            
            res.json(analysisResults);
        });
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