const defaultDB={
 users:[{user:'adm',pass:'0000',role:'ADM'},{user:'atendimento',pass:'0000',role:'Atendimento'},{user:'atendimento2',pass:'0000',role:'Atendimento'},{user:'caixa',pass:'0000',role:'Caixa'}],
 empresa:{nome:'MotoSOS Gestão',doc:'00.000.000/0001-00',tel:'(47) 99999-9999',end:'Rua Exemplo, 123 - Camboriú/SC',logo:''},
 clientes:[],motos:[],os:[],vendas:[],estoque:[],financeiro:[],funcionarios:[],chamados:[],audit:[],notasFiscais:[],plan:'Start',cargos:{mecanico:'Mecânico',vendedor:'Vendedor'}
};
let db={},current=null,tempEdit=null,currentCaixaItem=null;
let currentOficinaId=null,currentOficinaStatus='',currentSupabaseUser=null,currentAssinatura=null;
let configComercial={pro_fundador_limite:15,pro_fundador_valor:149.90,pro_valor:209.90,desconto_pix_percentual:5,taxa_boleto_faturado:49.90,juros_faturado_30:10,juros_faturado_60:25,juros_faturado_90:40};
let fundadoresUsados=0;

// ===== Conexão Supabase / MotoSOS Admin =====
const SUPABASE_REST_URL='https://mbpjlkbwcbjcpsjxgtlj.supabase.co/rest/v1';
const SUPABASE_FUNCTIONS_URL='https://mbpjlkbwcbjcpsjxgtlj.supabase.co/functions/v1';
const SUPABASE_KEY='sb_publishable_CFtFDFgdSuQ_Tn_vBayF8g_NQeu23c_';
const USE_SUPABASE=true;

function supabaseHeaders(extra={}){
  return {
    'apikey':SUPABASE_KEY,
    'Authorization':'Bearer '+SUPABASE_KEY,
    'Content-Type':'application/json',
    ...extra
  };
}
function storageKey(){
  return currentOficinaId ? `motosos_db_v3_oficina_${currentOficinaId}` : 'motosos_db_v3';
}
function mapPerfilToRole(perfil){
  const p=String(perfil||'').toLowerCase();
  if(p==='caixa')return 'Caixa';
  if(p==='atendente' || p==='atendimento' || p==='vendedor')return 'Atendente';
  return 'ADM';
}
function roleToPerfil(role){
  const r=String(role||'').toLowerCase();
  if(r==='caixa')return 'caixa';
  if(r==='atendente' || r==='atendimento')return 'atendente';
  return 'adm';
}
function precisaTrocarSenha(usuario){
  // Pede troca de login/senha apenas quando o banco marcar primeiro_acesso = true.
  // Depois que salvar, primeiro_acesso vira false e não pede novamente.
  return Boolean(usuario?.primeiro_acesso);
}
async function buscarLoginSupabase(usuario,senha){
  const email=encodeURIComponent(String(usuario||'').trim().toLowerCase());
  const pass=encodeURIComponent(String(senha||'').trim());
  const url=`${SUPABASE_REST_URL}/usuarios_sistema?email=eq.${email}&senha=eq.${pass}&ativo=eq.true&select=*&limit=1`;
  const resp=await fetch(url,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function buscarOficinaSupabase(oficinaId){
  const resp=await fetch(`${SUPABASE_REST_URL}/oficinas?id=eq.${oficinaId}&select=*&limit=1`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function buscarAssinaturaSupabase(oficinaId){
  const resp=await fetch(`${SUPABASE_REST_URL}/assinaturas?oficina_id=eq.${oficinaId}&select=*&order=id.desc&limit=1`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}

async function carregarConfigComercialSupabase(){
  try{
    const resp=await fetch(`${SUPABASE_REST_URL}/configuracoes_comerciais?select=*&order=id.asc&limit=1`,{headers:supabaseHeaders()});
    if(resp.ok){
      const arr=await resp.json();
      if(arr && arr[0]) configComercial={...configComercial,...arr[0]};
    }
  }catch(e){console.warn('Config comercial não carregou:',e);}
  try{
    const resp2=await fetch(`${SUPABASE_REST_URL}/assinaturas?plano=eq.Pro%20Fundador&status=eq.Ativa&select=id`,{headers:supabaseHeaders()});
    if(resp2.ok){fundadoresUsados=(await resp2.json()).length||0;}
  }catch(e){console.warn('Contagem fundador não carregou:',e);}
}
function valorBasePlano(plano){
  return String(plano||'').toLowerCase().includes('fundador') ? Number(configComercial.pro_fundador_valor||149.90) : Number(configComercial.pro_valor||209.90);
}
function fundadoresRestantes(){return Math.max(0, Number(configComercial.pro_fundador_limite||15)-Number(fundadoresUsados||0));}
function calcularValorUpgrade(){
  const plano=val('upgradePlano')||'Pro';
  const forma=val('upgradeForma')||'PIX';
  const prazo=val('upgradePrazo')||'30';
  let valor=valorBasePlano(plano);
  if(plano==='Pro Fundador' && fundadoresRestantes()<=0) valor=Number(configComercial.pro_valor||209.90);
  if(forma==='PIX') valor=valor*(1-Number(configComercial.desconto_pix_percentual||0)/100);
  if(forma==='FATURADO'){
    const juros=Number(configComercial[`juros_faturado_${prazo}`]||0);
    valor=valor*(1+juros/100)+Number(configComercial.taxa_boleto_faturado||0);
  }
  return Math.round(valor*100)/100;
}
function atualizarResumoUpgrade(){
  const forma=val('upgradeForma')||'PIX';
  const cartao=document.getElementById('cartaoBox'); if(cartao)cartao.classList.toggle('show',forma==='CREDIT_CARD');
  ['prazoFaturadoBox','responsavelFaturadoBox'].forEach(id=>{let e=document.getElementById(id); if(e)e.classList.toggle('show',forma==='FATURADO')});
  const v=calcularValorUpgrade();
  const resumo=document.getElementById('upgradeValorResumo'); if(resumo)resumo.value=money(v);
  const result=document.getElementById('upgradeResultado');
  if(result){
    const plano=val('upgradePlano')||'Pro';
    const desconto=forma==='PIX'?` com ${Number(configComercial.desconto_pix_percentual||0)}% de desconto`:'';
    const extra=forma==='FATURADO'?` + taxa de aprovação ${money(configComercial.taxa_boleto_faturado||49.90)}`:'';
    result.innerHTML=`<b>${plano}</b> via <b>${forma}</b>${desconto}${extra}<br>Valor final: <b>${money(v)}</b>`;
  }
}
function preencherDadosUpgrade(){
  const nome=document.getElementById('upgradeNome'); if(nome && !nome.value)nome.value=db.empresa.nome||current?.nome||'';
  const doc=document.getElementById('upgradeDoc'); if(doc && !doc.value)doc.value=db.empresa.doc||'';
  const tel=document.getElementById('upgradeTelefone'); if(tel && !tel.value)tel.value=db.empresa.tel||'';
  const email=document.getElementById('upgradeEmail'); if(email && !email.value)email.value=currentSupabaseUser?.email||current?.user||'';
}
async function solicitarUpgradePlano(){
  try{
    const plano=val('upgradePlano')||'Pro';
    const forma=val('upgradeForma')||'PIX';
    const valor=calcularValorUpgrade();
    const nome=val('upgradeNome').trim();
    const cpf_cnpj=val('upgradeDoc').trim();
    const email=val('upgradeEmail').trim();
    const telefone=val('upgradeTelefone').trim();
    if(!nome||!cpf_cnpj||!email)return alert('Preencha nome/razão social, CPF/CNPJ e e-mail.');
    if(plano==='Pro Fundador' && fundadoresRestantes()<=0)return alert('As vagas do Pro Fundador acabaram. Escolha o Plano Pro oficial.');
    if(forma==='FATURADO'){
      const taxaAprovacao = Number(configComercial.taxa_boleto_faturado || 49.90);

      const payload={
        oficina_id:currentOficinaId,
        assinatura_id:currentAssinatura?.id||null,
        nome_razao_social:nome,
        cpf_cnpj,
        email,
        telefone,
        prazo_solicitado:(val('upgradePrazo')||'30')+' dias',
        responsavel_financeiro:val('upgradeResponsavel'),
        observacao:`Plano solicitado: ${plano}. Valor final se aprovado: ${money(valor)}. Taxa de aprovação: ${money(taxaAprovacao)}. ${val('upgradeObs')||''}`,
        status:'Pendente'
      };

      const resp=await fetch(`${SUPABASE_REST_URL}/solicitacoes_boleto_faturado`,{
        method:'POST',
        headers:supabaseHeaders({'Prefer':'return=representation'}),
        body:JSON.stringify(payload)
      });
      if(!resp.ok)throw new Error(await resp.text());

      let taxaHtml = '';
      try{
        const taxaResp=await fetch(`${SUPABASE_FUNCTIONS_URL}/asaas-upgrade-pro`,{
          method:'POST',
          headers:supabaseHeaders(),
          body:JSON.stringify({
            oficina_id:currentOficinaId,
            assinatura_id:currentAssinatura?.id||null,
            billingType:'BOLETO',
            valor:taxaAprovacao,
            nome,
            cpf_cnpj,
            email,
            telefone,
            plano:'Taxa de aprovação boleto faturado'
          })
        });

        const taxaData=await taxaResp.json().catch(()=>({}));
        if(!taxaResp.ok || taxaData.ok===false)throw new Error(taxaData.erro||taxaData.message||JSON.stringify(taxaData));
        const pay=taxaData.payment||taxaData;

        if(pay.invoiceUrl){
          taxaHtml += `<br><br><b>Taxa de aprovação gerada:</b> ${money(taxaAprovacao)}<br>`;
          taxaHtml += `<button class="green" onclick="window.open('${pay.invoiceUrl}','_blank')">Abrir boleto da taxa</button>`;
        }else{
          taxaHtml += `<br><br><b>Taxa de aprovação:</b> ${money(taxaAprovacao)}<br><span class="muted">Cobrança criada, mas o link não retornou.</span>`;
        }
      }catch(errTaxa){
        console.error('Erro ao gerar taxa de aprovação:', errTaxa);
        taxaHtml += `<br><br><span style="color:#fca5a5"><b>Atenção:</b> solicitação enviada, mas houve erro ao gerar a taxa de aprovação. Veja o Console.</span>`;
      }

      document.getElementById('upgradeResultado').innerHTML=
        `Solicitação de boleto faturado enviada para análise. Status: <b>Pendente</b>.${taxaHtml}`;
      return;
    }
    const body={oficina_id:currentOficinaId,assinatura_id:currentAssinatura?.id||null,billingType:forma,valor,nome,cpf_cnpj,email,telefone,plano};
    if(forma==='CREDIT_CARD'){
      body.creditCard={holderName:val('cardHolderName'),number:val('cardNumber'),expiryMonth:val('cardExpiryMonth'),expiryYear:val('cardExpiryYear'),ccv:val('cardCcv')};
      body.creditCardHolderInfo={name:val('cardHolderName')||nome,email,cpfCnpj:val('cardCpfCnpj')||cpf_cnpj,postalCode:'88340000',addressNumber:'0',phone:telefone,mobilePhone:telefone};
    }
    const resp=await fetch(`${SUPABASE_FUNCTIONS_URL}/asaas-upgrade-pro`,{method:'POST',headers:supabaseHeaders(),body:JSON.stringify(body)});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok || data.ok===false)throw new Error(data.erro||data.message||JSON.stringify(data));
    const pay=data.payment||data;
    let html=`Cobrança gerada com sucesso.<br><b>Valor:</b> ${money(valor)}<br>`;
    if(pay.invoiceUrl)html+=`<button class="green" onclick="window.open('${pay.invoiceUrl}','_blank')">Abrir cobrança</button> `;
    if(pay.pixCopiaCola)html+=`<button class="secondary" onclick="copiarTexto('${String(pay.pixCopiaCola).replace(/'/g,"\\'")}')">Copiar PIX</button>`;
    if(pay.encodedImage)html+=`<div style="margin-top:10px"><img src="data:image/png;base64,${pay.encodedImage}" style="max-width:210px;background:white;padding:8px;border-radius:8px"></div>`;
    document.getElementById('upgradeResultado').innerHTML=html;
  }catch(e){console.error(e);alert('Erro ao solicitar upgrade. Veja o Console.');}
}
function renderPlanoComercial(){
  const pf=document.getElementById('precoProFundador'); if(pf)pf.innerText=money(configComercial.pro_fundador_valor||149.90);
  const po=document.getElementById('precoProOficial'); if(po)po.innerText=money(configComercial.pro_valor||209.90);
  const fr=document.getElementById('fundadorRestantes'); if(fr)fr.innerText=`${fundadoresRestantes()} vaga(s) restantes`;
  const up=document.getElementById('upgradePlano');
  if(up){
    const semVaga=fundadoresRestantes()<=0;
    [...up.options].forEach(o=>{if(o.value==='Pro Fundador')o.disabled=semVaga;});
    if(semVaga && up.value==='Pro Fundador')up.value='Pro';
  }
  preencherDadosUpgrade();
  atualizarResumoUpgrade();
}


async function carregarUsuariosSistemaSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/usuarios_sistema?oficina_id=eq.${currentOficinaId}&select=*&order=id.asc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  db.usuariosSistema=await resp.json()||[];
}
async function atualizarUsuarioSistemaSupabase(id,dados){
  const resp=await fetch(`${SUPABASE_REST_URL}/usuarios_sistema?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',headers:supabaseHeaders({'Prefer':'return=representation'}),body:JSON.stringify(dados)
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();return arr[0]||null;
}
async function criarUsuarioSistemaSupabase(dados){
  const resp=await fetch(`${SUPABASE_REST_URL}/usuarios_sistema`,{
    method:'POST',headers:supabaseHeaders({'Prefer':'return=representation'}),body:JSON.stringify(dados)
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();return arr[0]||null;
}
async function salvarPrimeiroAcesso(){
  try{
    const novoLogin=val('primeiroLoginNovo').trim();
    const novaSenha=val('primeiraSenhaNova').trim();
    const confirma=val('primeiraSenhaConfirma').trim();
    if(!novoLogin||!novaSenha||!confirma)return alert('Preencha novo login, nova senha e confirmação.');
    if(novaSenha.length<4)return alert('A senha precisa ter pelo menos 4 caracteres.');
    if(novaSenha!==confirma)return alert('As senhas não conferem.');
    const atualizado=await atualizarUsuarioSistemaSupabase(currentSupabaseUser.id,{email:novoLogin,senha:novaSenha,primeiro_acesso:false});
    currentSupabaseUser={...currentSupabaseUser,...atualizado,email:novoLogin,senha:novaSenha,primeiro_acesso:false};
    if(current){current.user=novoLogin;current.pass=novaSenha;}
    document.getElementById('currentUser').innerText=currentSupabaseUser.nome||novoLogin;
    document.getElementById('firstAccessOverlay').classList.remove('show');
    alert('Login e senha alterados com sucesso.');
    await carregarUsuariosSistemaSupabase();renderAll();
  }catch(e){console.error(e);alert('Erro ao alterar login/senha. Verifique se o login já não está em uso.');}
}
function abrirPrimeiroAcesso(usuario){
  const o=document.getElementById('firstAccessOverlay'); if(!o)return;
  document.getElementById('primeiroLoginNovo').value=usuario?.email||'';
  document.getElementById('primeiraSenhaNova').value='';
  document.getElementById('primeiraSenhaConfirma').value='';
  o.classList.add('show');
}

async function carregarClientesSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/clientes?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.clientes=(arr||[]).map(c=>({
    id:c.id,
    tipo:'Completo',
    nome:c.nome||'',
    telefone:c.telefone||'',
    doc:c.cpf_cnpj||'',
    email:c.email||'',
    cep:c.cep||'',
    endereco:c.endereco||'',
    numero:c.numero||'',
    bairro:c.bairro||'',
    cidade:c.cidade||'',
    estado:c.estado||''
  }));
}
async function criarClienteSupabase(c){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/clientes`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      nome:c.nome,
      telefone:c.telefone||null,
      cpf_cnpj:c.doc||null,
      email:c.email||null,
      cep:c.cep||null,
      endereco:c.endereco||null,
      numero:c.numero||null,
      bairro:c.bairro||null,
      cidade:c.cidade||null,
      estado:c.estado||null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function atualizarClienteSupabase(id,c){
  const resp=await fetch(`${SUPABASE_REST_URL}/clientes?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      nome:c.nome,
      telefone:c.telefone||null,
      cpf_cnpj:c.doc||null,
      email:c.email||null,
      cep:c.cep||null,
      endereco:c.endereco||null,
      numero:c.numero||null,
      bairro:c.bairro||null,
      cidade:c.cidade||null,
      estado:c.estado||null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  return await resp.json();
}
async function excluirClienteSupabase(id){
  const resp=await fetch(`${SUPABASE_REST_URL}/clientes?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'DELETE',
    headers:supabaseHeaders()
  });
  if(!resp.ok)throw new Error(await resp.text());
}

async function carregarMotosSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/motos?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.motos=(arr||[]).map(m=>({
    id:m.id,
    clienteId:m.cliente_id,
    placa:m.placa||'',
    marca:m.marca||'',
    modelo:m.modelo||'',
    cor:m.cor||'',
    ano:m.ano||'',
    km:m.km||'',
    obs:m.observacoes||''
  }));
}
async function criarMotoSupabase(m){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/motos`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      cliente_id:m.clienteId,
      marca:m.marca||null,
      modelo:m.modelo||null,
      ano:m.ano||null,
      placa:m.placa||null,
      cor:m.cor||null,
      km:m.km||null,
      observacoes:m.obs||null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function excluirMotoSupabase(id){
  const resp=await fetch(`${SUPABASE_REST_URL}/motos?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'DELETE',
    headers:supabaseHeaders()
  });
  if(!resp.ok)throw new Error(await resp.text());
}


async function carregarOSSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.os=(arr||[]).map(o=>({
    id:o.id,
    numero:o.numero_os || ('OS'+String(o.id).padStart(4,'0')),
    clienteId:o.cliente_id,
    motoId:o.moto_id,
    problema:o.problema_relatado||'',
    status:o.status||'Aguardando aprovação',
    vendedorId:o.vendedor_id||'',
    data:(o.criado_em||'').slice(0,10)||todayISO(),
    entregaData:null,
    pagamentoData:null,
    pecas:Array.isArray(o.itens_pecas)?o.itens_pecas:[],
    mao:Array.isArray(o.itens_mao_obra)?o.itens_mao_obra:[],
    valorTotal:Number(o.valor_total||0)
  }));
}
async function criarOSSupabase(o){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      cliente_id:o.clienteId,
      moto_id:o.motoId,
      numero_os:o.numero,
      status:o.status||'Aguardando aprovação',
      problema_relatado:o.problema||null,
      observacoes:o.observacoes||null,
      mao_obra:0,
      valor_pecas:0,
      valor_total:0,
      itens_pecas:o.pecas||[],
      itens_mao_obra:o.mao||[]
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function atualizarOSSupabase(o){
  const valorMao=(o.mao||[]).reduce((s,m)=>s+Number(m.valor||0),0);
  const valorPecas=(o.pecas||[]).reduce((s,p)=>s+Number(p.total||0),0);
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?id=eq.${o.id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      status:o.status,
      problema_relatado:o.problema||null,
      mao_obra:valorMao,
      valor_pecas:valorPecas,
      valor_total:valorMao+valorPecas,
      itens_pecas:o.pecas||[],
      itens_mao_obra:o.mao||[]
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  return await resp.json();
}
async function excluirOSSupabase(id){
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'DELETE',
    headers:supabaseHeaders()
  });
  if(!resp.ok)throw new Error(await resp.text());
}


async function carregarEstoqueSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/estoque?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.estoque=(arr||[]).map(p=>({
    id:p.id,
    codigo:p.codigo||String(p.id).padStart(11,'0'),
    produto:p.descricao||'',
    qtd:Number(p.quantidade||0),
    custo:Number(p.custo||0),
    venda:Number(p.preco_venda||0),
    fornecedor:p.fornecedor||'',
    ncm:p.ncm||'',cest:p.cest||'',unidade_comercial:p.unidade_comercial||'UN',origem_mercadoria:p.origem_mercadoria||'0',cfop:p.cfop||'',codigo_barras:p.codigo_barras||'',marca:p.marca||'',cst_csosn:p.cst_csosn||'',aliquota_icms:p.aliquota_icms||''
  }));
}
async function criarEstoqueSupabase(p){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/estoque`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      codigo:p.codigo||null,
      descricao:p.produto,
      quantidade:Number(p.qtd||0),
      custo:Number(p.custo||0),
      preco_venda:Number(p.venda||0),
      percentual_lucro:Number(p.percentual_lucro||0),
      fornecedor:p.fornecedor||null,ncm:p.ncm||null,cest:p.cest||null,unidade_comercial:p.unidade_comercial||'UN',origem_mercadoria:p.origem_mercadoria||'0',cfop:p.cfop||null,codigo_barras:p.codigo_barras||null,marca:p.marca||null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function atualizarEstoqueSupabase(id,p){
  const resp=await fetch(`${SUPABASE_REST_URL}/estoque?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      codigo:p.codigo||null,
      descricao:p.produto,
      quantidade:Number(p.qtd||0),
      custo:Number(p.custo||0),
      preco_venda:Number(p.venda||0),
      percentual_lucro:Number(p.percentual_lucro||0),
      fornecedor:p.fornecedor||null,ncm:p.ncm||null,cest:p.cest||null,unidade_comercial:p.unidade_comercial||'UN',origem_mercadoria:p.origem_mercadoria||'0',cfop:p.cfop||null,codigo_barras:p.codigo_barras||null,marca:p.marca||null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  return await resp.json();
}
async function excluirEstoqueSupabase(id){
  const resp=await fetch(`${SUPABASE_REST_URL}/estoque?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'DELETE',
    headers:supabaseHeaders()
  });
  if(!resp.ok)throw new Error(await resp.text());
}


async function carregarVendasSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/vendas?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.vendas=(arr||[]).map(v=>({
    id:v.id,
    numero:v.numero_venda || ('VEND'+String(v.id).padStart(4,'0')),
    tipo:'Venda balcão',
    clienteId:v.cliente_id || '',
    produtoId:v.produto_id || '',
    codigo:'',
    produto:v.produto_descricao || '',
    vendedorId:'',
    vendedorNome:v.vendedor || '-',
    qtd:Number(v.quantidade||1),
    unit:Number(v.valor_unitario||0),
    total:Number(v.valor_total||0),
    data:(v.criado_em||'').slice(0,10)||todayISO(),
    status:v.status||'Aberta',
    formaPagamento:v.forma_pagamento||'',
    pagamentoData:null,
    notaEmitida:String(v.status||'').toLowerCase()==='finalizada'
  }));
}
async function criarVendaSupabase(v){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/vendas`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      cliente_id:v.clienteId?Number(v.clienteId):null,
      produto_id:v.produtoId?Number(v.produtoId):null,
      numero_venda:v.numero,
      vendedor:v.vendedorNome||current?.nome||current?.user||'Usuário',
      produto_descricao:v.produto||null,
      quantidade:Number(v.qtd||1),
      valor_unitario:Number(v.unit||0),
      valor_total:Number(v.total||0),
      forma_pagamento:v.formaPagamento||null,
      status:v.status||'Aberta'
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function atualizarVendaSupabase(id,dados){
  const resp=await fetch(`${SUPABASE_REST_URL}/vendas?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify(dados)
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}

async function atualizarQuantidadeEstoqueSupabase(produtoId,novaQuantidade){
  const resp=await fetch(`${SUPABASE_REST_URL}/estoque?id=eq.${produtoId}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({quantidade:Number(novaQuantidade||0)})
  });
  if(!resp.ok)throw new Error(await resp.text());
  return await resp.json();
}

async function carregarFinanceiroOficinaSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/financeiro_oficina?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.financeiroOficina=(arr||[]).map(f=>({
    id:f.id,
    oficinaId:f.oficina_id,
    origem:f.origem||'',
    origemId:f.origem_id||'',
    tipo:f.tipo||'Entrada',
    desc:f.descricao||'',
    valor:Number(f.valor||0),
    formaPagamento:f.forma_pagamento||'',
    status:f.status||'Recebido',
    data:(f.criado_em||'').slice(0,10)||todayISO()
  }));
}
async function criarFinanceiroOficinaSupabase(lancamento){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/financeiro_oficina`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      origem:lancamento.origem||null,
      origem_id:lancamento.origemId?Number(lancamento.origemId):null,
      tipo:lancamento.tipo||'Entrada',
      descricao:lancamento.descricao||null,
      valor:Number(lancamento.valor||0),
      forma_pagamento:lancamento.formaPagamento||null,
      status:lancamento.status||'Recebido'
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}

async function carregarCaixaSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/caixa?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.caixa=(arr||[]).map(c=>({
    id:c.id,
    oficinaId:c.oficina_id,
    tipo:c.tipo||'Saída',
    desc:c.descricao||'',
    valor:Number(c.valor||0),
    origem:c.origem||'Manual',
    origemId:c.origem_id||null,
    data:(c.criado_em||'').slice(0,10)||todayISO()
  }));
}
async function criarCaixaSupabase(lancamento){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/caixa`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      tipo:lancamento.tipo||'Saída',
      descricao:lancamento.descricao||null,
      valor:Number(lancamento.valor||0),
      origem:lancamento.origem||'Manual',
      origem_id:lancamento.origemId?Number(lancamento.origemId):null
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function addCaixaManual(){
  const tipo=val('caixaTipo');
  const descricao=val('caixaDesc').trim();
  const valor=Number(val('caixaValor')||0);
  if(!descricao)return alert('Informe a descrição.');
  if(valor<=0)return alert('Informe um valor maior que zero.');
  try{
    await criarCaixaSupabase({tipo,descricao,valor,origem:'Manual'});
    await carregarCaixaSupabase();
      await carregarNotasFiscaisSupabase();
    clear(['caixaDesc']);
    const cv=document.getElementById('caixaValor'); if(cv)cv.value=0;
    renderAll();
    alert('Movimento lançado no caixa.');
  }catch(e){
    console.error(e);
    alert('Erro ao lançar no caixa. Confira Console/Network.');
  }
}
function sinalCaixa(tipo){
  const t=String(tipo||'').toLowerCase();
  if(t.includes('saída')||t.includes('saida')||t.includes('sangria'))return -1;
  return 1;
}
function renderCaixa(){
  const tableEl=document.getElementById('caixaTable');
  if(!tableEl)return;
  const hoje=todayISO();
  const entradasFinanceiro=(db.financeiroOficina||[]).filter(f=>f.data===hoje && String(f.tipo||'').toLowerCase().includes('entrada'));
  const movCaixa=(db.caixa||[]).filter(c=>c.data===hoje);
  const linhas=[];
  entradasFinanceiro.forEach(f=>linhas.push({data:f.data,tipo:'Entrada / '+(f.origem||'Financeiro'),desc:f.desc||'-',valor:Number(f.valor||0)}));
  movCaixa.forEach(c=>linhas.push({data:c.data,tipo:c.tipo,desc:c.desc||'-',valor:Number(c.valor||0)*sinalCaixa(c.tipo)}));
  const entradas=linhas.filter(l=>l.valor>=0).reduce((s,l)=>s+l.valor,0);
  const saidas=Math.abs(linhas.filter(l=>l.valor<0).reduce((s,l)=>s+l.valor,0));
  const saldo=entradas-saidas;
  const ce=document.getElementById('caixaEntradas'); if(ce)ce.innerText=money(entradas);
  const cs=document.getElementById('caixaSaidas'); if(cs)cs.innerText=money(saidas);
  const csl=document.getElementById('caixaSaldo'); if(csl)csl.innerText=money(saldo);
  const cm=document.getElementById('caixaMovimentos'); if(cm)cm.innerText=linhas.length;
  table('caixaTable',['Data','Tipo','Descrição','Valor'],linhas.map(l=>[brDate(l.data),l.tipo,l.desc,money(l.valor)]));
}

function aplicarDadosOficinaNoApp(oficina,assinatura){
  if(!oficina)return;
  db.empresa.nome=oficina.nome_fantasia || oficina.razao_social || db.empresa.nome || 'MotoSOS Gestão';
  db.empresa.doc=oficina.cnpj_cpf || db.empresa.doc || '';
  db.empresa.tel=oficina.whatsapp || oficina.telefone || db.empresa.tel || '';
  db.empresa.end=[oficina.endereco,oficina.numero,oficina.bairro,oficina.cidade,oficina.estado].filter(Boolean).join(' - ');
  db.plan=assinatura?.plano || db.plan || 'Start';
}
function diasAteVencimento(data){
  if(!data)return null;
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const venc=new Date(data+'T00:00:00');
  return Math.ceil((venc-hoje)/(1000*60*60*24));
}
function verificarAvisoAssinatura(){
  if(!currentAssinatura)return;
  const dias=diasAteVencimento(currentAssinatura.data_vencimento);
  if(dias===null)return;
  if(dias<0){
    setTimeout(()=>alert('Sua assinatura está vencida. Regularize o pagamento para evitar bloqueio do sistema.'),400);
  }else if(dias<=5){
    setTimeout(()=>alert(`Atenção: sua assinatura vence em ${dias} dia(s). Regularize o pagamento para manter o acesso.`),400);
  }
}

function load(){
  db=JSON.parse(localStorage.getItem(storageKey())||JSON.stringify(defaultDB));
  if(db.agenda) delete db.agenda;
  if(!db.cargos) db.cargos={mecanico:'Mecânico',vendedor:'Vendedor'};
  if(!db.chamados) db.chamados=[];
  if(!db.financeiroOficina) db.financeiroOficina=[];
  if(!db.caixa) db.caixa=[];
  if(!db.users.some(u=>u.user==='caixa')) db.users.push({user:'caixa',pass:'0000',role:'Caixa'});
  db.users.forEach(u=>{if(u.user==='caixa')u.role='Caixa'});
  db.vendas.forEach(v=>{if(!v.status)v.status='Aberta'});
  normalizarNumeracaoDocumentos();
  localStorage.setItem(storageKey(),JSON.stringify(db));
}
function normalizarNumeracaoDocumentos(){
  (db.vendas||[]).forEach((v,i)=>{v.numero='VEND'+String(i+1).padStart(4,'0')});
  (db.os||[]).forEach((o,i)=>{o.numero='OS'+String(i+1).padStart(4,'0')});
}
function save(){localStorage.setItem(storageKey(),JSON.stringify(db));renderAll()}
function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function val(id){return document.getElementById(id)?.value||''}
function todayISO(){return new Date().toISOString().slice(0,10)}
function brDate(iso){if(!iso)return'';let [y,m,d]=iso.split('-');return `${d}/${m}/${y}`}
function audit(msg){db.audit.unshift({data:new Date().toLocaleString('pt-BR'),user:current?.user||'sistema',msg});save()}
function clear(ids){ids.forEach(id=>{let e=document.getElementById(id);if(e)e.value=''})}
async function login(){
  let u=val('loginUser').trim(),p=val('loginPass').trim();
  if(!u||!p)return alert('Informe usuário e senha.');

  try{
    const usuario=await buscarLoginSupabase(u,p);
    if(!usuario)return alert('Usuário ou senha inválidos.');

    const oficina=await buscarOficinaSupabase(usuario.oficina_id);
    if(!oficina)return alert('Oficina não encontrada. Fale com o suporte MotoSOS.');

    const assinatura=await buscarAssinaturaSupabase(usuario.oficina_id);
    const statusOficina=String(oficina.status||'').trim();
    const statusAssinatura=String(assinatura?.status||'').trim();

    if(['Bloqueada','Cancelada'].includes(statusOficina) || statusAssinatura==='Cancelada'){
      alert('Acesso bloqueado por pendência financeira ou assinatura cancelada. Regularize a mensalidade com o MotoSOS para acessar novamente.');
      return;
    }

    currentOficinaId=usuario.oficina_id;
    currentOficinaStatus=statusOficina;
    currentSupabaseUser=usuario;
    currentAssinatura=assinatura;

    // Carrega o banco local separado desta oficina neste navegador.
    load();
    aplicarDadosOficinaNoApp(oficina,assinatura);
    await carregarClientesSupabase();
    await carregarMotosSupabase();
    await carregarOSSupabase();
    await carregarEstoqueSupabase();
    await carregarVendasSupabase();
    await carregarFuncionariosSupabase();
    await carregarFinanceiroOficinaSupabase();
    await carregarCaixaSupabase();
    await carregarUsuariosSistemaSupabase();
    await carregarConfigComercialSupabase();

    current={
      user:usuario.email,
      nome:usuario.nome,
      pass:usuario.senha,
      role:mapPerfilToRole(usuario.perfil),
      perfil:usuario.perfil,
      oficina_id:usuario.oficina_id
    };

    document.body.classList.toggle('caixa-mode',current.role==='Caixa');
    document.getElementById('login').style.display='none';
    document.getElementById('app').style.display='block';
    document.getElementById('currentUser').innerText=usuario.nome||usuario.email;
    document.getElementById('currentRole').innerText=current.role;
    buildNav();
    renderAll();
    showSection(current.role==='Caixa'?'caixa':'dashboard');
    verificarAvisoAssinatura();
    if(precisaTrocarSenha(usuario)) abrirPrimeiroAcesso(usuario);
    save();
  }catch(e){
    console.error(e);
    alert('Erro ao entrar. Verifique sua internet ou fale com o suporte MotoSOS.');
  }
}
function logout(){
  current=null;
  currentOficinaId=null;
  currentOficinaStatus='';
  currentSupabaseUser=null;
  currentAssinatura=null;
  tempEdit=null;
  currentCaixaItem=null;
  document.body.classList.remove('caixa-mode');
  const loginEl=document.getElementById('login');
  const appEl=document.getElementById('app');
  if(loginEl)loginEl.style.display='flex';
  if(appEl)appEl.style.display='none';
  const userEl=document.getElementById('loginUser');
  const passEl=document.getElementById('loginPass');
  if(userEl)userEl.value='';
  if(passEl)passEl.value='';
}

async function refreshSupabaseDataForSection(sectionId){
  if(!currentOficinaId)return;
  try{
    if(['dashboard','financeiro','caixa','fechamentoCaixa','nfEntrada','relatorios','vendas','estoque'].includes(sectionId)){
      await carregarClientesSupabase();
      await carregarMotosSupabase();
      await carregarOSSupabase();
      await carregarEstoqueSupabase();
      await carregarVendasSupabase();
      await carregarFinanceiroOficinaSupabase();
      await carregarCaixaSupabase();
    }
  }catch(e){
    console.error('Erro ao atualizar dados do Supabase:', e);
  }
}

function atualizarCardsFinanceiroECaixa(){
  const vendasTotal=(db.vendas||[]).reduce((s,v)=>s+Number(v.total||v.valor_total||0),0);
  const osAbertasTotal=(db.os||[]).filter(o=>String(o.status||'')!=='Entregue').reduce((s,o)=>s+osTotal(o),0);
  const entradasFinanceiro=(db.financeiroOficina||[]).filter(f=>String(f.tipo||'').toLowerCase().includes('entrada')).reduce((s,f)=>s+Number(f.valor||0),0);
  const saidasFinanceiro=(db.financeiroOficina||[]).filter(f=>String(f.tipo||'').toLowerCase().includes('saída')||String(f.tipo||'').toLowerCase().includes('saida')).reduce((s,f)=>s+Number(f.valor||0),0);
  const entradasCaixa=(db.caixa||[]).filter(c=>sinalCaixa(c.tipo)>0).reduce((s,c)=>s+Number(c.valor||0),0);
  const saidasCaixa=(db.caixa||[]).filter(c=>sinalCaixa(c.tipo)<0).reduce((s,c)=>s+Number(c.valor||0),0);

  const finGeral=document.getElementById('finGeralTotal'); if(finGeral)finGeral.innerText=money(vendasTotal);
  const finOs=document.getElementById('finOsAbertasTotal'); if(finOs)finOs.innerText=money(osAbertasTotal);
  const finEnt=document.getElementById('finEntradasTotal'); if(finEnt)finEnt.innerText=money(entradasFinanceiro+entradasCaixa);
  const finSai=document.getElementById('finSaidasTotal'); if(finSai)finSai.innerText=money(saidasFinanceiro+saidasCaixa);

  const cxEntradas=document.getElementById('caixaEntradas'); if(cxEntradas)cxEntradas.innerText=money(entradasFinanceiro+entradasCaixa);
  const cxSaidas=document.getElementById('caixaSaidas'); if(cxSaidas)cxSaidas.innerText=money(saidasFinanceiro+saidasCaixa);
  const cxSaldo=document.getElementById('caixaSaldo'); if(cxSaldo)cxSaldo.innerText=money((entradasFinanceiro+entradasCaixa)-(saidasFinanceiro+saidasCaixa));
  const cxMov=document.getElementById('caixaMovimentos'); if(cxMov)cxMov.innerText=(db.financeiroOficina||[]).length+(db.caixa||[]).length;
}

function toggleMenu(open){document.getElementById('drawer').classList.toggle('open',open);document.getElementById('overlay').classList.toggle('show',open)}
function planKey(){let p=(db.plan||'Start').toLowerCase();if(p.includes('pro'))return 'pro';return 'start'}
function sectionAllowed(id){
  if(id==='impressao')return true;
  if(current && current.role==='Caixa')return ['caixa','fechamentoCaixa','financeiro','relatorios','impressao'].includes(id);
  if(current && current.role==='Atendente')return ['dashboard','clientes','motos','os','orcamentos','vendas','estoque','impressao'].includes(id);

  const key=planKey();

  // Regras oficiais: Start = Operação + Plano. Pro/Pro Fundador = acesso total.
  const start=['dashboard','clientes','motos','os','orcamentos','vendas','estoque','planos'];
  const pro=['dashboard','clientes','motos','os','orcamentos','vendas','estoque','compras','nfEntrada','fiscal','garantias','financeiro','caixa','funcionarios','relatorios','usuarios','contatoPro','configuracoes','planos','auditoria'];

  return (key==='pro'?pro:start).includes(id);
}
function upgradeMessage(id){
  if(['financeiro','caixa','relatorios','usuarios','configuracoes','auditoria','funcionarios','contatoPro','compras','nfEntrada','fiscal','garantias'].includes(id))return 'Este recurso está disponível somente no Plano Pro.';
  return 'Este recurso não está disponível no plano atual.';
}
function buildMobileBottom(items){
  const mb=document.getElementById('mobileBottom');
  if(!mb)return;
  if(current && current.role==='Caixa'){
    mb.innerHTML=`<button onclick="showSection('caixa')"><b>💰</b>Caixa</button><button onclick="logout()"><b>↩</b>Sair</button>`;
    return;
  }
  const icon={dashboard:'⌂',clientes:'👤',motos:'🏍',os:'🧾',vendas:'🛒',estoque:'📦',financeiro:'💰',caixa:'💵'};
  const prioridade=['dashboard','clientes','motos','os','vendas','estoque','financeiro','caixa'];
  const visiveis=prioridade.map(id=>items.find(i=>i[0]===id)).filter(Boolean).slice(0,4);
  mb.innerHTML=visiveis.map(i=>`<button onclick="showSection('${i[0]}')"><b>${icon[i[0]]||'•'}</b>${i[1]}</button>`).join('')+`<button onclick="toggleMenu(true)"><b>☰</b>Menu</button>`;
}
function navButton(i){
  const icon={dashboard:'⌂',clientes:'👤',motos:'🏍️',os:'🧾',orcamentos:'📋',vendas:'🛒',estoque:'📦',financeiro:'💰',caixa:'💵',fechamentoCaixa:'🧾',nfEntrada:'📥',funcionarios:'👥',relatorios:'📊',usuarios:'🔐',contatoPro:'💬',configuracoes:'⚙️',planos:'⭐',auditoria:'🕒'};
  return `<button id="nav-${i[0]}" onclick="showSection('${i[0]}')"><span class="nav-ico">${icon[i[0]]||'•'}</span>${i[1]}</button>`;
}
function renderDepartmentNav(groups){
  const nav=document.getElementById('nav');
  if(!nav)return;
  nav.innerHTML=groups.filter(g=>g.items.length).map(g=>`
    <div class="nav-group">
      <div class="nav-group-title">${g.title}</div>
      ${g.items.map(navButton).join('')}
    </div>
  `).join('');
}
function buildNav(){
  if(current.role==='Caixa'){
    const gestao=[['caixa','Caixa'],['fechamentoCaixa','Fechamento de Caixa'],['financeiro','Financeiro'],['relatorios','Relatórios']];
    renderDepartmentNav([{title:'Gestão',items:gestao}]);
    buildMobileBottom(gestao);
    return;
  }

  const operacao=[
    ['dashboard','Dashboard'],['clientes','Clientes'],['motos','Motos'],['os','O.S.'],['orcamentos','Orçamentos'],['vendas','Vendas'],['estoque','Estoque']
  ].filter(i=>sectionAllowed(i[0]));

  const gestao=[
    ['caixa','Caixa'],['fechamentoCaixa','Fechamento de Caixa'],['nfEntrada','NF Entrada'],['financeiro','Financeiro'],['relatorios','Relatórios']
  ].filter(i=>sectionAllowed(i[0]));

  const administracao=[
    ['funcionarios','Funcionários'],['usuarios','Usuários'],['configuracoes','Configurações'],['planos','Plano'],['auditoria','Auditoria'],['contatoPro','Contato Pro']
  ].filter(i=>sectionAllowed(i[0]));

  renderDepartmentNav([
    {title:'Operação',items:operacao},
    {title:'Gestão',items:gestao},
    {title:'Administração',items:administracao}
  ]);
  buildMobileBottom([...operacao,...gestao,...administracao]);
}
async function showSection(id){
  if(!sectionAllowed(id)){alert(upgradeMessage(id));id='dashboard'}
  let el=document.getElementById(id);if(!el)return;
  await refreshSupabaseDataForSection(id);
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  let n=document.getElementById('nav-'+id);if(n)n.classList.add('active');
  toggleMenu(false);
  renderAll();
  atualizarCardsFinanceiroECaixa();
}
function table(id,heads,rows){let e=document.getElementById(id);if(!e)return;e.innerHTML='<tr>'+heads.map(h=>`<th>${h}</th>`).join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(c=>`<td>${c}</td>`).join('')+'</tr>').join('')}
function fillSelect(id,opts){let e=document.getElementById(id);if(!e)return;let cur=e.value;e.innerHTML='<option value="">Selecione</option>'+opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('');e.value=cur}
function cliente(id){return db.clientes.find(c=>String(c.id)===String(id))||{}}
function clienteName(id){return cliente(id).nome||'-'}
function moto(id){return db.motos.find(m=>String(m.id)===String(id))||{}}
function motoName(id){let m=moto(id);return m.placa?`${m.modelo} - ${m.placa}`:'-'}
function produto(id){return db.estoque.find(p=>String(p.id)===String(id))||{}}
function func(id){return db.funcionarios.find(f=>String(f.id)===String(id))||{}}
async function buscarCep(tipo){
  let cepEl = tipo==='edit'?document.getElementById('editClienteCep'):document.getElementById('clienteCep');
  let cep = cepEl.value.replace(/\D/g,'');
  if(cep.length!==8) return;
  try{
    let r=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    let d=await r.json();
    if(d.erro){alert('CEP não encontrado.');return}
    const pre = tipo==='edit'?'editCliente':'cliente';
    document.getElementById(pre+'Endereco').value=d.logradouro||'';
    document.getElementById(pre+'Bairro').value=d.bairro||'';
    document.getElementById(pre+'Cidade').value=d.localidade||'';
    document.getElementById(pre+'Estado').value=d.uf||'';
  }catch(e){alert('Não foi possível buscar o CEP agora.')}
}
async function addCliente(){
  let c={tipo:'Completo',nome:val('clienteNome'),telefone:val('clienteTelefone'),doc:val('clienteDoc'),email:val('clienteEmail'),cep:val('clienteCep'),endereco:val('clienteEndereco'),numero:val('clienteNumero'),bairro:val('clienteBairro'),cidade:val('clienteCidade'),estado:val('clienteEstado')};
  if(!c.nome||!c.telefone)return alert('Nome e telefone são obrigatórios.');
  try{
    await criarClienteSupabase(c);
    await carregarClientesSupabase();
    clear(['clienteNome','clienteTelefone','clienteDoc','clienteEmail','clienteCep','clienteEndereco','clienteNumero','clienteBairro','clienteCidade','clienteEstado']);
    alert('Cliente salvo no Supabase com sucesso.');
    audit('Criou cliente '+c.nome);
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao salvar cliente no Supabase.');
  }
}
function editCliente(id){
  let c=cliente(id); if(!c.id)return;
  document.getElementById('editClienteBox').style.display='block';
  document.getElementById('editClienteId').value=c.id;
  document.getElementById('editClienteNome').value=c.nome||'';
  document.getElementById('editClienteTelefone').value=c.telefone||'';
  document.getElementById('editClienteDoc').value=c.doc||'';
  document.getElementById('editClienteEmail').value=c.email||'';
  document.getElementById('editClienteCep').value=c.cep||'';
  document.getElementById('editClienteEndereco').value=c.endereco||'';
  document.getElementById('editClienteNumero').value=c.numero||'';
  document.getElementById('editClienteBairro').value=c.bairro||'';
  document.getElementById('editClienteCidade').value=c.cidade||'';
  document.getElementById('editClienteEstado').value=c.estado||'';
}
async function saveClienteEdit(){
  let id=Number(val('editClienteId'));
  let c={
    nome:val('editClienteNome'),
    telefone:val('editClienteTelefone'),
    doc:val('editClienteDoc'),
    email:val('editClienteEmail'),
    cep:val('editClienteCep'),
    endereco:val('editClienteEndereco'),
    numero:val('editClienteNumero'),
    bairro:val('editClienteBairro'),
    cidade:val('editClienteCidade'),
    estado:val('editClienteEstado')
  };
  if(!id)return alert('Cliente não identificado.');
  if(!c.nome||!c.telefone)return alert('Nome e telefone são obrigatórios.');
  try{
    await atualizarClienteSupabase(id,c);
    await carregarClientesSupabase();
    document.getElementById('editClienteBox').style.display='none';
    alert('Cliente atualizado no Supabase.');
    audit('Editou cliente '+c.nome);
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao atualizar cliente no Supabase.');
  }
}
async function deleteCliente(id){
  if(!confirm('Excluir este cliente?'))return;
  try{
    await excluirClienteSupabase(id);
    await carregarClientesSupabase();
    renderAll();
    alert('Cliente excluído.');
  }catch(e){
    console.error(e);
    alert('Erro ao excluir cliente. Verifique se ele não está vinculado a motos ou O.S.');
  }
}
function cancelClienteEdit(){document.getElementById('editClienteBox').style.display='none'}



function consultaPlacaLiberada(){return false}
function puxarDadosMotoPorPlaca(){
  const key=planKey();
  if(key==='start'){
    alert('Consulta automática de placa indisponível no Plano Start. Preencha marca, modelo, cor e ano manualmente.');
    return;
  }
  alert('Consulta automática de placa em breve para os planos Oficina e Pro. Por enquanto, preencha marca, modelo, cor e ano manualmente.');
}

async function addMoto(){
  let m={
    clienteId:val('motoCliente'),
    placa:val('motoPlaca').toUpperCase().trim(),
    marca:val('motoMarca'),
    modelo:val('motoModelo'),
    cor:val('motoCor'),
    ano:val('motoAno'),
    km:'',
    obs:''
  };
  if(!m.clienteId||!m.placa||!m.marca||!m.modelo||!m.cor||!m.ano){
    return alert('Cliente, placa, marca, modelo, cor e ano são obrigatórios.');
  }
  try{
    await criarMotoSupabase(m);
    await carregarMotosSupabase();
    clear(['motoPlaca','motoMarca','motoModelo','motoCor','motoAno']);
    alert('Moto salva no Supabase com sucesso.');
    audit('Cadastrou moto '+m.placa);
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao salvar moto no Supabase.');
  }
}
async function deleteMoto(id){
  if(!confirm('Excluir esta moto?'))return;
  try{
    await excluirMotoSupabase(id);
    await carregarMotosSupabase();
    renderAll();
    alert('Moto excluída.');
  }catch(e){
    console.error(e);
    alert('Erro ao excluir moto. Verifique se ela não está vinculada a uma O.S.');
  }
}
function buscarMotoPorPlaca(){
  let placa=val('osBuscaPlaca').toUpperCase().replace(/\s/g,'');
  let m=db.motos.find(x=>(x.placa||'').toUpperCase().replace(/\s/g,'')===placa);
  let box=document.getElementById('osDadosEncontrados');
  if(!m){
    document.getElementById('osCliente').value=''; document.getElementById('osMoto').value='';
    box.innerHTML='Placa não encontrada. Cadastre o cliente e a moto antes de abrir a O.S.';
    return;
  }
  let c=cliente(m.clienteId);
  document.getElementById('osCliente').value=c.id;
  document.getElementById('osMoto').value=m.id;
  box.innerHTML=`<b>Cliente:</b> ${c.nome}<br><b>Telefone:</b> ${c.telefone}<br><b>Moto:</b> ${m.modelo} | <b>Placa:</b> ${m.placa} | <b>Cor:</b> ${m.cor||'-'}`;
}
function nextSequenceNumber(items,prefix){
  let maior=0;
  (items||[]).forEach(item=>{
    let numero=String(item.numero||'').toUpperCase();
    let n=0;
    if(numero.startsWith(prefix)){
      n=parseInt(numero.slice(prefix.length).replace(/\D/g,''),10);
    }
    if(!isNaN(n)&&n>maior)maior=n;
  });
  return prefix+String(maior+1).padStart(4,'0');
}
function proximaOS(){return nextSequenceNumber(db.os,'OS')}
function proximaVenda(){return nextSequenceNumber(db.vendas,'VEND')}
async function addOS(){
  let o={
    numero:proximaOS(),
    clienteId:val('osCliente'),
    motoId:val('osMoto'),
    problema:val('osProblema'),
    status:val('osStatus') || 'Aguardando aprovação',
    vendedorId:val('osVendedor'),
    data:todayISO(),
    entregaData:null,
    pagamentoData:null,
    pecas:[],
    mao:[]
  };
  if(!o.clienteId||!o.motoId)return alert('Digite uma placa cadastrada para puxar cliente e moto.');
  try{
    await criarOSSupabase(o);
    await carregarOSSupabase();
    clear(['osProblema','osBuscaPlaca']);
    document.getElementById('osDadosEncontrados').innerHTML='Digite uma placa já cadastrada para puxar cliente e moto automaticamente.';
    alert('O.S. salva no Supabase com sucesso.');
    audit('Criou '+o.numero);
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao salvar O.S. no Supabase.');
  }
}
function startEditOS(id){let o=db.os.find(x=>x.id===id);tempEdit=JSON.parse(JSON.stringify(o));document.getElementById('editOSBox').style.display='block';document.getElementById('editOSId').value=id;document.getElementById('editOSTitle').innerText='Editar '+o.numero;document.getElementById('editOSStatus').value=o.status;renderOSItens()}
function cancelOSEdit(){tempEdit=null;document.getElementById('editOSBox').style.display='none'}
function addPecaToOS(){if(!tempEdit)return;let pid=val('osPecaSelect'),qtd=Number(val('osPecaQtd'));let p=produto(pid);if(!p.id)return alert('Selecione uma peça do estoque.');if(qtd<=0)return alert('Quantidade inválida.');if(qtd>Number(p.qtd))return alert('Estoque insuficiente. Disponível: '+p.qtd);tempEdit.pecas.push({produtoId:p.id,codigo:p.codigo,nome:p.produto,qtd,unit:Number(p.venda),total:qtd*Number(p.venda)});renderOSItens()}
function addMaoToOS(){if(!tempEdit)return;let fid=val('osMecanico'),mec=func(fid),desc=val('osMaoDesc'),valor=Number(val('osMaoValor'));if(!mec.id)return alert('Selecione o mecânico.');if(!desc||valor<=0)return alert('Descrição e valor são obrigatórios.');let com=valor*(Number(mec.comissao||0)/100);tempEdit.mao.push({funcId:mec.id,mecanico:mec.nome,desc,valor,comissaoPerc:Number(mec.comissao||0),comissaoValor:com});clear(['osMaoDesc']);document.getElementById('osMaoValor').value=0;renderOSItens()}
function renderOSItens(){let d=document.getElementById('osItensResumo');if(!tempEdit){d.innerHTML='';return}let pecas=tempEdit.pecas.map((p,i)=>`<div>Peça: ${p.codigo} - ${p.nome} | Qtd ${p.qtd} | Total ${money(p.total)} <button class="small secondary" onclick="tempEdit.pecas.splice(${i},1);renderOSItens()">remover</button></div>`).join('')||'<div>Nenhuma peça.</div>';let mao=tempEdit.mao.map((m,i)=>`<div>M.O.: ${m.desc} | ${m.mecanico} | ${money(m.valor)} | Comissão ${money(m.comissaoValor)} <button class="small secondary" onclick="tempEdit.mao.splice(${i},1);renderOSItens()">remover</button></div>`).join('')||'<div>Nenhuma mão de obra.</div>';d.innerHTML='<b>Peças</b>'+pecas+'<br><b>Mão de obra</b>'+mao}
async function saveOSEdit(){
  let id=Number(val('editOSId'));
  let idx=db.os.findIndex(o=>o.id===id);
  if(idx<0)return;
  let old=db.os[idx];
  let oldPecas=old.pecas||[];
  let newPecas=tempEdit.pecas||[];
  for(let p of newPecas){
    let oldQtd=oldPecas.filter(x=>x.produtoId===p.produtoId).reduce((s,x)=>s+x.qtd,0);
    let newQtd=newPecas.filter(x=>x.produtoId===p.produtoId).reduce((s,x)=>s+x.qtd,0);
    if(newQtd>oldQtd){let prod=produto(p.produtoId);let diff=newQtd-oldQtd;if(diff>Number(prod.qtd))return alert('Estoque insuficiente para '+prod.produto)}
  }
  oldPecas.forEach(p=>{let prod=produto(p.produtoId);if(prod.id)prod.qtd=Number(prod.qtd)+Number(p.qtd)});
  newPecas.forEach(p=>{let prod=produto(p.produtoId);if(prod.id)prod.qtd=Number(prod.qtd)-Number(p.qtd)});
  let newStatus=val('editOSStatus');
  if(newStatus==='Entregue' && old.status!=='Entregue') tempEdit.entregaData=todayISO();
  if(newStatus!=='Entregue') tempEdit.entregaData=null;
  tempEdit.status=newStatus;
  try{
    await atualizarOSSupabase(tempEdit);
    db.os[idx]=tempEdit;
    tempEdit=null;
    document.getElementById('editOSBox').style.display='none';
    await carregarOSSupabase();
    alert('O.S. atualizada no Supabase.');
    audit('Editou O.S. '+(db.os[idx]?.numero||id));
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao atualizar O.S. no Supabase.');
  }
}

async function deleteOS(id){
  if(!confirm('Excluir esta O.S.?'))return;
  try{
    await excluirOSSupabase(id);
    await carregarOSSupabase();
    renderAll();
    alert('O.S. excluída.');
  }catch(e){
    console.error(e);
    alert('Erro ao excluir O.S.');
  }
}

function clienteMotosResumo(clienteId){
  const motos=db.motos.filter(m=>String(m.clienteId)===String(clienteId));
  if(!motos.length)return 'Nenhuma moto cadastrada';
  return motos.map(m=>`${m.placa||'Sem placa'} - ${m.marca||''} ${m.modelo||''}`.trim()).join(' | ');
}
function abrirBuscaClienteVenda(){
  const modal=document.getElementById('modalBuscaClienteVenda');
  if(!modal)return;
  modal.classList.add('show');
  const inp=document.getElementById('buscaClienteVendaInput');
  if(inp){inp.value='';setTimeout(()=>inp.focus(),50)}
  renderBuscaClienteVenda();
}
function fecharBuscaClienteVenda(){
  const modal=document.getElementById('modalBuscaClienteVenda');
  if(modal)modal.classList.remove('show');
}
function renderBuscaClienteVenda(){
  const box=document.getElementById('listaBuscaClienteVenda'); if(!box)return;
  const termo=(val('buscaClienteVendaInput')||'').toLowerCase().trim();
  const lista=db.clientes.filter(c=>{
    const motos=db.motos.filter(m=>String(m.clienteId)===String(c.id));
    const placas=motos.map(m=>m.placa||'').join(' ').toLowerCase();
    const texto=`${c.nome||''} ${c.telefone||''} ${c.cpf||''} ${c.cpf_cnpj||''} ${placas}`.toLowerCase();
    return !termo || texto.includes(termo);
  });
  if(!lista.length){box.innerHTML='<div class="hint">Nenhum cliente encontrado.</div>';return;}
  box.innerHTML=lista.map(c=>`
    <div class="pick-card">
      <div class="pick-card-main">
        <div class="pick-title">${c.nome||'Sem nome'}</div>
        <div class="pick-sub">Telefone: ${c.telefone||'-'} | Documento: ${c.cpf||c.cpf_cnpj||'-'}</div>
        <div class="pick-sub">Motos: ${clienteMotosResumo(c.id)}</div>
      </div>
      <button class="small blue" onclick="selecionarClienteVenda('${c.id}')">Selecionar</button>
    </div>
  `).join('');
}
function selecionarClienteVenda(id){
  const c=cliente(id); if(!c.id)return;
  document.getElementById('vendaCliente').value=c.id;
  document.getElementById('vendaClienteNome').value=`${c.nome||'Cliente'}${c.telefone?' - '+c.telefone:''}`;
  fecharBuscaClienteVenda();
}
function abrirBuscaProdutoVenda(){
  const modal=document.getElementById('modalBuscaProdutoVenda');
  if(!modal)return;
  modal.classList.add('show');
  const inp=document.getElementById('buscaProdutoVendaInput');
  if(inp){inp.value='';setTimeout(()=>inp.focus(),50)}
  renderBuscaProdutoVenda();
}
function fecharBuscaProdutoVenda(){
  const modal=document.getElementById('modalBuscaProdutoVenda');
  if(modal)modal.classList.remove('show');
}
function renderBuscaProdutoVenda(){
  const box=document.getElementById('listaBuscaProdutoVenda'); if(!box)return;
  const termo=(val('buscaProdutoVendaInput')||'').toLowerCase().trim();
  const lista=db.estoque.filter(p=>{
    const texto=`${p.codigo||''} ${p.produto||''} ${p.marca||''} ${p.fornecedor||''} ${p.ncm||''}`.toLowerCase();
    return Number(p.qtd)>0 && (!termo || texto.includes(termo));
  });
  if(!lista.length){box.innerHTML='<div class="hint">Nenhum produto encontrado no estoque.</div>';return;}
  box.innerHTML=lista.map(p=>`
    <div class="pick-card">
      <div class="pick-card-main">
        <div class="pick-title">${p.codigo||''} - ${p.produto||'Produto'}</div>
        <div class="pick-sub">Preço: ${money(p.venda)} | Estoque: ${p.qtd} | Marca: ${p.marca||'-'}</div>
        <div class="pick-sub">Fornecedor: ${p.fornecedor||'-'} | NCM: ${p.ncm||'-'}</div>
      </div>
      <button class="small green" onclick="selecionarProdutoVenda('${p.id}')">Selecionar</button>
    </div>
  `).join('');
}
function selecionarProdutoVenda(id){
  const p=produto(id); if(!p.id)return;
  document.getElementById('vendaProduto').value=p.id;
  document.getElementById('vendaProdutoNome').value=`${p.codigo||''} - ${p.produto||'Produto'} | ${money(p.venda)} | Est: ${p.qtd}`;
  fecharBuscaProdutoVenda();
}

async function addVenda(){
  let tipo='Venda balcão',pid=val('vendaProduto'),qtd=Number(val('vendaQtd')), vendedorId=val('vendaVendedor');
  let p=produto(pid);
  if(!p.id)return alert('Selecione produto registrado no estoque.');
  if(qtd<=0)return alert('Quantidade inválida.');
  if(qtd>Number(p.qtd))return alert('Estoque insuficiente. Disponível: '+p.qtd);
  let total=qtd*Number(p.venda);
  let vendedorNome=(vendedorId&&func(vendedorId).nome)?func(vendedorId).nome:(current?.nome||current?.user||'Usuário');
  let v={
    numero:proximaVenda(),
    tipo,
    clienteId:val('vendaCliente')||null,
    produtoId:p.id,
    codigo:p.codigo,
    produto:p.produto,
    vendedorId,
    vendedorNome,
    qtd,
    unit:Number(p.venda),
    total,
    data:todayISO(),
    status:'Aberta',
    pagamentoData:null,
    notaEmitida:false,
    formaPagamento:null
  };
  try{
    await criarVendaSupabase(v);
    await atualizarQuantidadeEstoqueSupabase(p.id,Number(p.qtd)-qtd);
    await carregarEstoqueSupabase();
    await carregarVendasSupabase();
    document.getElementById('vendaQtd').value=1;
    const vcn=document.getElementById('vendaClienteNome'); if(vcn)vcn.value='';
    const vpn=document.getElementById('vendaProdutoNome'); if(vpn)vpn.value='';
    const vc=document.getElementById('vendaCliente'); if(vc)vc.value='';
    const vp=document.getElementById('vendaProduto'); if(vp)vp.value='';
    alert('Venda salva e estoque baixado com sucesso. Agora ela aparecerá no Caixa para pagamento, forma de pagamento e emissão da NF.');
    audit('Criou '+v.numero+' e enviou para o caixa');
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao salvar venda no Supabase. Confira o Console/Network.');
  }
}
function emitirNotaVenda(id){
  let v=db.vendas.find(x=>String(x.id)===String(id));
  if(!v)return;
  if(v.status!=='Finalizada'){
    iniciarPagamentoCaixa(id);
    showSection('caixa');
    alert('A NF será emitida no Caixa após escolher a forma de pagamento e confirmar o recebimento.');
    return;
  }
  alert('NF já emitida para '+v.numero+'.');
}

function proximoCodigoProduto(){
  let maior=0;
  db.estoque.forEach(p=>{
    let n=parseInt(String(p.codigo||'').replace(/\D/g,''),10);
    if(!isNaN(n) && n>maior) maior=n;
  });
  return String(maior+1).padStart(11,'0');
}
function calcularMargemEstoque(){
  let custo=Number(val('estoqueCusto')||0);
  let venda=Number(val('estoqueVenda')||0);
  let margemEl=document.getElementById('estoqueMargem');
  if(!margemEl)return;
  if(custo<=0 || venda<=0){margemEl.value='';return;}
  let margem=((venda-custo)/custo)*100;
  margemEl.value=margem.toFixed(2).replace('.',',')+'%';
}
function margemEstoqueNumero(custo,venda){
  custo=Number(custo||0);
  venda=Number(venda||0);
  if(custo<=0 || venda<=0)return 0;
  return Number((((venda-custo)/custo)*100).toFixed(2));
}
function editEstoque(id){
  let p=db.estoque.find(x=>String(x.id)===String(id));
  if(!p)return;
  document.getElementById('estoqueEditId').value=p.id;
  document.getElementById('estoqueCodigo').value=p.codigo;
  document.getElementById('estoqueProduto').value=p.produto||'';
  document.getElementById('estoqueQtd').value=p.qtd ?? '';
  document.getElementById('estoqueCusto').value=p.custo ?? '';
  document.getElementById('estoqueVenda').value=p.venda ?? '';
  document.getElementById('estoqueFornecedor').value=p.fornecedor||'';
  document.getElementById('estoqueNcm').value=p.ncm||'';
  document.getElementById('estoqueCest').value=p.cest||'';
  document.getElementById('estoqueUnidade').value=p.unidade_comercial||'UN';
  document.getElementById('estoqueOrigem').value=p.origem_mercadoria||'0';
  document.getElementById('estoqueCfop').value=p.cfop||'';
  document.getElementById('estoqueEan').value=p.codigo_barras||'';
  document.getElementById('estoqueMarca').value=p.marca||'';
  document.getElementById('estoqueCst').value=p.cst_csosn||'';
  document.getElementById('estoqueIcms').value=p.aliquota_icms||'';
  calcularMargemEstoque();
}
async function deleteEstoque(id){
  let usadoOS=db.os.flatMap(o=>o.pecas||[]).some(p=>String(p.produtoId)===String(id));
  let usadoVenda=db.vendas.some(v=>String(v.produtoId)===String(id));
  if(usadoOS||usadoVenda)return alert('Não é possível excluir: produto já foi usado em O.S. ou venda.');
  if(!confirm('Excluir produto do estoque?'))return;
  try{
    await excluirEstoqueSupabase(id);
    await carregarEstoqueSupabase();
    alert('Produto excluído do Supabase.');
    audit('Excluiu produto do estoque');
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao excluir produto do estoque no Supabase.');
  }
}
function cancelEstoqueEdit(){
  let codEl=document.getElementById('estoqueCodigo');
  if(codEl)codEl.value=proximoCodigoProduto();
  document.getElementById('estoqueEditId').value='';
  clear(['estoqueProduto','estoqueQtd','estoqueCusto','estoqueVenda','estoqueMargem','estoqueFornecedor']);
  renderAll();
}

async function addEstoque(){
  let editId=val('estoqueEditId');
  let nome=val('estoqueProduto').trim();
  if(!nome)return alert('Produto é obrigatório.');
  let qtd=Number(val('estoqueQtd')||0);
  let custo=Number(val('estoqueCusto')||0);
  let venda=Number(val('estoqueVenda')||0);
  let produtoDados={
    codigo:val('estoqueCodigo') || proximoCodigoProduto(),
    produto:nome,
    qtd:qtd,
    custo:custo,
    venda:venda,
    fornecedor:val('estoqueFornecedor'),ncm:val('estoqueNcm'),cest:val('estoqueCest'),unidade_comercial:val('estoqueUnidade')||'UN',origem_mercadoria:val('estoqueOrigem')||'0',cfop:val('estoqueCfop'),codigo_barras:val('estoqueEan'),marca:val('estoqueMarca'),cst_csosn:val('estoqueCst'),aliquota_icms:val('estoqueIcms'),
    percentual_lucro:margemEstoqueNumero(custo,venda)
  };
  try{
    if(editId){
      await atualizarEstoqueSupabase(editId,produtoDados);
      alert('Produto atualizado no Supabase.');
      audit('Editou produto '+produtoDados.codigo);
    }else{
      await criarEstoqueSupabase(produtoDados);
      alert('Produto salvo no Supabase com sucesso.');
      audit('Adicionou estoque '+produtoDados.codigo);
    }
    await carregarEstoqueSupabase();
    document.getElementById('estoqueEditId').value='';
    clear(['estoqueProduto','estoqueQtd','estoqueCusto','estoqueVenda','estoqueMargem','estoqueFornecedor']);
    let codEl=document.getElementById('estoqueCodigo');
    if(codEl)codEl.value=proximoCodigoProduto();
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao salvar produto no Supabase.');
  }
}
function addFinanceiro(){db.financeiro.push({id:Date.now(),data:todayISO(),tipo:val('finTipo'),desc:val('finDesc'),valor:Number(val('finValor'))});clear(['finDesc']);document.getElementById('finValor').value=0;audit('Lançou financeiro')}

async function carregarFuncionariosSupabase(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/funcionarios?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.funcionarios=(arr||[]).map(f=>({
    id:f.id,
    nome:f.nome||'',
    cpf:f.cpf||'',
    telefone:f.telefone||'',
    cargo:f.cargo||'Mecânico I',
    salario:Number(f.salario||0),
    comissao:Number(f.comissao_percentual||0),
    dataAdmissao:f.data_admissao||'',
    status:f.status||'Ativo'
  }));
}
async function criarFuncionarioSupabase(f){
  const resp=await fetch(`${SUPABASE_REST_URL}/funcionarios`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      nome:f.nome,
      cpf:f.cpf||null,
      telefone:f.telefone||null,
      cargo:f.cargo||null,
      salario:Number(f.salario||0),
      comissao_percentual:Number(f.comissao||0),
      data_admissao:f.dataAdmissao||null,
      status:f.status||'Ativo'
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  return arr[0]||null;
}
async function atualizarFuncionarioSupabase(id,f){
  const resp=await fetch(`${SUPABASE_REST_URL}/funcionarios?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      nome:f.nome,
      cpf:f.cpf||null,
      telefone:f.telefone||null,
      cargo:f.cargo||null,
      salario:Number(f.salario||0),
      comissao_percentual:Number(f.comissao||0),
      data_admissao:f.dataAdmissao||null,
      status:f.status||'Ativo'
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  return await resp.json();
}
async function excluirFuncionarioSupabase(id){
  const resp=await fetch(`${SUPABASE_REST_URL}/funcionarios?id=eq.${id}&oficina_id=eq.${currentOficinaId}`,{
    method:'DELETE',
    headers:supabaseHeaders()
  });
  if(!resp.ok)throw new Error(await resp.text());
}

function cargoNome(tipo){
  if(!db.cargos) db.cargos={mecanico:'Mecânico',vendedor:'Vendedor'};
  if(!db.chamados) db.chamados=[];
  if(!db.financeiroOficina) db.financeiroOficina=[];
  if(!db.caixa) db.caixa=[];
  if(!db.users.some(u=>u.user==='caixa')) db.users.push({user:'caixa',pass:'0000',role:'Caixa'});
  db.users.forEach(u=>{if(u.user==='caixa')u.role='Caixa'});
  return db.cargos[tipo] || tipo;
}
function saveCargos(){
  db.cargos={
    mecanico:val('cargoMecanicoNome')||'Mecânico',
    vendedor:val('cargoVendedorNome')||'Vendedor'
  };
  audit('Alterou nomes dos cargos');
}

async function saveFuncionario(){
  let id=val('funcEditId');
  let f={
    nome:val('funcNome').trim(),
    cpf:val('funcCpf').trim(),
    telefone:val('funcTelefone').trim(),
    cargo:val('funcCargo'),
    salario:Number(val('funcSalario')||0),
    comissao:Number(val('funcComissao')||0),
    dataAdmissao:val('funcDataAdmissao'),
    status:val('funcStatus')||'Ativo'
  };
  if(!f.nome)return alert('Nome obrigatório.');
  try{
    if(id){
      await atualizarFuncionarioSupabase(id,f);
      audit('Editou funcionário '+f.nome);
    }else{
      await criarFuncionarioSupabase(f);
      audit('Cadastrou funcionário '+f.nome);
    }
    await carregarFuncionariosSupabase();
    cancelFuncEdit();
    renderAll();
    alert('Funcionário salvo no Supabase.');
  }catch(e){
    console.error(e);
    alert('Erro ao salvar funcionário. Confira Console/Network.');
  }
}
function editFunc(id){
  let f=func(id); if(!f.id)return;
  document.getElementById('funcEditId').value=f.id;
  document.getElementById('funcNome').value=f.nome||'';
  document.getElementById('funcCpf').value=f.cpf||'';
  document.getElementById('funcTelefone').value=f.telefone||'';
  document.getElementById('funcCargo').value=f.cargo||'Mecânico I';
  document.getElementById('funcSalario').value=(Number(f.salario)>0?f.salario:'');
  document.getElementById('funcComissao').value=(Number(f.comissao)>0?f.comissao:'');
  document.getElementById('funcDataAdmissao').value=f.dataAdmissao||'';
  document.getElementById('funcStatus').value=f.status||'Ativo';
  document.getElementById('funcFormTitle').innerText='Editar funcionário';
  showSection('funcionarios');
}
async function deleteFunc(id){
  let used=db.os.flatMap(o=>o.mao||[]).some(m=>String(m.funcId)===String(id));
  if(used)return alert('Não é possível excluir: esse mecânico já tem mão de obra lançada em O.S.');
  if(!confirm('Excluir funcionário?'))return;
  try{
    await excluirFuncionarioSupabase(id);
    await carregarFuncionariosSupabase();
    audit('Excluiu funcionário');
    renderAll();
  }catch(e){
    console.error(e);
    alert('Erro ao excluir funcionário.');
  }
}
function cancelFuncEdit(){
  document.getElementById('funcEditId').value='';
  clear(['funcNome','funcCpf','funcTelefone','funcDataAdmissao']);
  document.getElementById('funcCargo').value='Mecânico I';
  document.getElementById('funcSalario').value='';
  document.getElementById('funcComissao').value='';
  document.getElementById('funcStatus').value='Ativo';
  document.getElementById('funcFormTitle').innerText='Cadastro de funcionário';
}

function salvarLogoEmpresa(event){
  let file=event.target.files && event.target.files[0];
  if(!file)return;
  if(!file.type.startsWith('image/')){
    alert('Selecione uma imagem PNG ou JPG.');
    return;
  }
  if(file.size > 2 * 1024 * 1024){
    alert('A imagem deve ter no máximo 2 MB.');
    return;
  }
  let reader=new FileReader();
  reader.onload=function(e){
    db.empresa.logo=e.target.result;
    audit('Atualizou logo da empresa');
  };
  reader.readAsDataURL(file);
}

function saveEmpresa(){db.empresa={nome:val('empNome'),doc:val('empDoc'),tel:val('empTel'),end:val('empEnd'),logo:db.empresa.logo||''};audit('Alterou dados da empresa')}
function changePlan(){db.plan=val('planSelect');buildNav();let active=document.querySelector('.section.active');if(active&&!sectionAllowed(active.id))showSection('dashboard');audit('Alterou plano para '+db.plan)}
function dentroPeriodo(data){
  let ini=val('finInicio'), fim=val('finFim');
  if(ini && data<ini)return false;
  if(fim && data>fim)return false;
  return true;
}
function limparFiltroFinanceiro(){document.getElementById('finInicio').value='';document.getElementById('finFim').value='';renderAll()}
function osTotal(o){let totalItens=(o.pecas||[]).reduce((s,p)=>s+Number(p.total||0),0)+(o.mao||[]).reduce((s,m)=>s+Number(m.valor||0),0);return totalItens || Number(o.valorTotal||0)}

function limparFormUsuarioSistema(){
  clear(['usuarioSistemaId','usuarioSistemaNome','usuarioSistemaEmail','usuarioSistemaSenha']);
  const p=document.getElementById('usuarioSistemaPerfil'); if(p)p.value='atendente';
  const a=document.getElementById('usuarioSistemaAtivo'); if(a)a.value='true';
}
function editarUsuarioSistema(id){
  const u=(db.usuariosSistema||[]).find(x=>String(x.id)===String(id));
  if(!u)return alert('Usuário não encontrado.');
  document.getElementById('usuarioSistemaId').value=u.id;
  document.getElementById('usuarioSistemaNome').value=u.nome||'';
  document.getElementById('usuarioSistemaEmail').value=u.email||'';
  document.getElementById('usuarioSistemaSenha').value=u.senha||'';
  document.getElementById('usuarioSistemaPerfil').value=roleToPerfil(u.perfil||'atendente');
  document.getElementById('usuarioSistemaAtivo').value=String(Boolean(u.ativo));
  showSection('usuarios');
}
async function salvarUsuarioSistema(){
  try{
    if(!current || current.role!=='ADM')return alert('Apenas ADM pode gerenciar usuários.');
    const id=val('usuarioSistemaId');
    const nome=val('usuarioSistemaNome').trim();
    const email=val('usuarioSistemaEmail').trim();
    const senha=val('usuarioSistemaSenha').trim();
    const perfil=val('usuarioSistemaPerfil');
    const ativo=val('usuarioSistemaAtivo')==='true';
    if(!nome||!email||!senha)return alert('Nome, login e senha são obrigatórios.');
    const dados={oficina_id:currentOficinaId,nome,email,senha,perfil,ativo};
    if(id){
      dados.primeiro_acesso=true;
      await atualizarUsuarioSistemaSupabase(id,dados);
      alert('Usuário atualizado. No próximo login, ele deverá alterar login/senha.');
    }else{
      dados.primeiro_acesso=true;
      await criarUsuarioSistemaSupabase(dados);
      alert('Usuário criado. No primeiro login, ele deverá alterar login/senha.');
    }
    limparFormUsuarioSistema();
    await carregarUsuariosSistemaSupabase();
    renderAll();
  }catch(e){console.error(e);alert('Erro ao salvar usuário. Verifique se o login já não existe.');}
}
async function alternarUsuarioSistema(id,ativo){
  try{
    if(!current || current.role!=='ADM')return alert('Apenas ADM pode gerenciar usuários.');
    if(String(id)===String(currentSupabaseUser?.id) && !ativo)return alert('Você não pode desativar seu próprio usuário.');
    await atualizarUsuarioSistemaSupabase(id,{ativo});
    await carregarUsuariosSistemaSupabase();renderAll();
  }catch(e){console.error(e);alert('Erro ao alterar status do usuário.');}
}
async function redefinirSenhaUsuarioSistema(id){
  try{
    const nova=prompt('Digite a nova senha provisória:', '0000');
    if(!nova)return;
    await atualizarUsuarioSistemaSupabase(id,{senha:nova,primeiro_acesso:true});
    await carregarUsuariosSistemaSupabase();renderAll();
    alert('Senha redefinida. O usuário deverá alterar login/senha no próximo acesso.');
  }catch(e){console.error(e);alert('Erro ao redefinir senha.');}
}
async function buscarDocumentoEmpresa(){
  let doc=val('empDoc').replace(/\D/g,'');
  if(!doc)return;
  if(doc.length===14){
    try{
      let r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+doc);
      let d=await r.json();
      if(d && !d.message){
        document.getElementById('empNome').value=d.razao_social||d.nome_fantasia||val('empNome');
        document.getElementById('empTel').value=d.ddd_telefone_1||val('empTel');
        let end=[d.logradouro,d.numero,d.bairro,d.municipio,d.uf].filter(Boolean).join(', ');
        if(end)document.getElementById('empEnd').value=end;
        return;
      }
    }catch(e){}
    alert('Não foi possível puxar os dados do CNPJ agora. Você pode preencher manualmente ou deixar em branco.');
  }else if(doc.length===11){
    alert('CPF não possui consulta pública completa. Você pode preencher manualmente ou deixar em branco.');
  }else{
    alert('CPF/CNPJ inválido ou incompleto. O preenchimento é opcional.');
  }
}


function updatePlanUI(){
  let key=planKey();
  let autoBox=document.getElementById('placaAutoBox');
  let note=document.getElementById('placaManualNote');
  let btn=document.getElementById('btnConsultaPlaca');

  ['motoMarca','motoModelo','motoCor','motoAno'].forEach(id=>{
    let e=document.getElementById(id);
    if(e){
      e.readOnly=false;
      e.placeholder='Preencha manualmente';
    }
  });

  let placa=document.getElementById('motoPlaca');
  if(placa) placa.onblur=null;

  if(key==='start'){
    if(autoBox) autoBox.classList.add('locked');
    if(note) note.innerHTML='Consulta automática de placa indisponível no Plano Start. Preencha marca, modelo, cor e ano manualmente.';
  }else{
    if(autoBox) autoBox.classList.remove('locked');
    if(btn) btn.innerText='Consulta automática em breve';
    if(note) note.innerHTML='Consulta automática de placa em breve para o Plano Pro. Preencha os dados manualmente por enquanto.';
  }

  let pai=document.getElementById('planAccessInfo');
  if(pai){
    let label=key==='pro'?'Plano Pro: acesso total ao MotoSOS Gestão.':'Plano Start: Operação básica + aba Plano.';
    pai.innerHTML=label;
  }
  let currentPlan=document.getElementById('currentPlan');
  if(currentPlan) currentPlan.innerText=db.plan||'Start';
}


function setTextSafe(id,txt){let e=document.getElementById(id); if(e)e.innerText=txt;}
function planLimits(){return planKey()==='pro'?{nome:'Pro',adm:5,atendimento:20}:{nome:'Start',adm:1,atendimento:1};}
function dataItem(obj){return obj.data || (obj.criado_em||'').slice(0,10) || obj.criado || todayISO();}
function dentroPeriodoRel(data){
  let ini=val('relInicio'), fim=val('relFim');
  if(!data)return true;
  if(ini && data<ini)return false;
  if(fim && data>fim)return false;
  return true;
}
function mesLabel(data){
  if(!data)return '-';
  const p=String(data).slice(0,7).split('-');
  if(p.length<2)return data;
  return `${p[1]}/${p[0]}`;
}
function diaLabel(data){
  if(!data)return '-';
  const p=String(data).slice(0,10).split('-');
  if(p.length<3)return data;
  return `${p[2]}/${p[1]}`;
}
function agruparSoma(lista,getData,getValor,porMes=false){
  const mapa={};
  (lista||[]).forEach(item=>{
    const d=getData(item);
    if(!d || !dentroPeriodoRel(d))return;
    const chave=porMes?String(d).slice(0,7):String(d).slice(0,10);
    mapa[chave]=(mapa[chave]||0)+Number(getValor(item)||0);
  });
  return Object.keys(mapa).sort().map(k=>({chave:k,label:porMes?mesLabel(k):diaLabel(k),valor:mapa[k]}));
}
function agruparContagem(lista,getData,porMes=false){
  const mapa={};
  (lista||[]).forEach(item=>{
    const d=getData(item);
    if(!d || !dentroPeriodoRel(d))return;
    const chave=porMes?String(d).slice(0,7):String(d).slice(0,10);
    mapa[chave]=(mapa[chave]||0)+1;
  });
  return Object.keys(mapa).sort().map(k=>({chave:k,label:porMes?mesLabel(k):diaLabel(k),valor:mapa[k]}));
}
function renderGraficoBarra(id,dados,opts={}){
  const el=document.getElementById(id); if(!el)return;
  if(!dados || !dados.length){el.innerHTML='<div class="chart-empty">Sem dados no período.</div>';return;}
  const max=Math.max(...dados.map(d=>Number(d.valor)||0),1);
  el.innerHTML=`<div class="chart-bars">${dados.map(d=>{
    const h=Math.max(4,Math.round((Number(d.valor||0)/max)*145));
    const valor=opts.money?money(d.valor):String(Math.round(Number(d.valor||0)));
    return `<div class="chart-item"><div class="chart-value">${valor}</div><div class="chart-bar" style="height:${h}px"></div><div class="chart-label">${d.label}</div></div>`;
  }).join('')}</div>`;
}
function totalMaoOS(o){return (o.mao||[]).reduce((s,m)=>s+Number(m.valor||0),0) || Number(o.mao_obra||0) || 0;}
function renderRelatorios(){
  try{
    const vendas=(db.vendas||[]).filter(v=>dentroPeriodoRel(dataItem(v)));
    const oss=(db.os||[]).filter(o=>dentroPeriodoRel(dataItem(o)));
    const caixaMovs=(db.caixa||[]).filter(c=>dentroPeriodoRel(dataItem(c)));
    const estoque=(db.estoque||[]);

    const faturamento=vendas.reduce((s,v)=>s+Number(v.total||v.valor_total||0),0);
    const saldoCaixa=caixaMovs.reduce((s,c)=>s+(sinalCaixa(c.tipo)*Number(c.valor||0)),0);
    const osAbertas=oss.filter(o=>String(o.status||'').toLowerCase()!=='entregue').length;
    const valorEstoque=estoque.reduce((s,p)=>s+(Number(p.qtd||p.quantidade||0)*Number(p.venda||p.preco_venda||0)),0);

    setTextSafe('relFaturamento',money(faturamento));
    setTextSafe('relSaldoCaixa',money(saldoCaixa));
    setTextSafe('relQtdVendas',String(vendas.length));
    setTextSafe('relOsAbertas',String(osAbertas));
    setTextSafe('relQtdClientes',String((db.clientes||[]).length));
    setTextSafe('relQtdMotos',String((db.motos||[]).length));
    setTextSafe('relProdutosEstoque',String(estoque.length));
    setTextSafe('relValorEstoque',money(valorEstoque));

    renderGraficoBarra('graficoVendasDia',agruparSoma(db.vendas||[],dataItem,v=>v.total||v.valor_total||0,false),{money:true});
    renderGraficoBarra('graficoVendasMes',agruparSoma(db.vendas||[],dataItem,v=>v.total||v.valor_total||0,true),{money:true});
    renderGraficoBarra('graficoOsDia',agruparContagem(db.os||[],dataItem,false));
    renderGraficoBarra('graficoOsMes',agruparContagem(db.os||[],dataItem,true));
    renderGraficoBarra('graficoMaoObraMes',agruparSoma(db.os||[],dataItem,totalMaoOS,true),{money:true});

    const prodMap={};
    (db.vendas||[]).filter(v=>dentroPeriodoRel(dataItem(v))).forEach(v=>{
      const nome=v.produto||v.produto_descricao||'Produto';
      if(!prodMap[nome])prodMap[nome]={qtd:0,total:0};
      prodMap[nome].qtd+=Number(v.qtd||v.quantidade||0);
      prodMap[nome].total+=Number(v.total||v.valor_total||0);
    });
    const produtos=Object.entries(prodMap).sort((a,b)=>b[1].qtd-a[1].qtd).slice(0,10).map(([nome,d])=>[nome,d.qtd,money(d.total)]);
    table('relProdutosTable',['Produto','Qtd','Total'],produtos);

    const entradas=caixaMovs.filter(c=>sinalCaixa(c.tipo)>0).reduce((s,c)=>s+Number(c.valor||0),0);
    const saidas=caixaMovs.filter(c=>sinalCaixa(c.tipo)<0).reduce((s,c)=>s+Number(c.valor||0),0);
    const maoTotal=oss.reduce((s,o)=>s+totalMaoOS(o),0);
    table('relFinanceiroTable',['Indicador','Valor'],[
      ['Faturamento em vendas',money(faturamento)],
      ['Mão de obra em O.S.',money(maoTotal)],
      ['Entradas no caixa',money(entradas)],
      ['Saídas no caixa',money(saidas)],
      ['Saldo do caixa',money(entradas-saidas)]
    ]);
    table('relVendasTable',['Data','Nº','Cliente','Produto','Qtd','Total','Status'],vendas.slice(0,15).map(v=>[brDate(dataItem(v)),v.numero||v.numero_venda,clienteName(v.clienteId||v.cliente_id),v.produto||v.produto_descricao,Number(v.qtd||v.quantidade||0),money(v.total||v.valor_total||0),v.status||'-']));
    table('relOsTable',['Data','Nº','Cliente','Moto','Status','Mão de obra','Total'],oss.slice(0,15).map(o=>[brDate(dataItem(o)),o.numero||o.numero_os,clienteName(o.clienteId||o.cliente_id),motoName(o.motoId||o.moto_id),o.status||'-',money(totalMaoOS(o)),money(osTotal(o)||o.valorTotal||0)]));
  }catch(e){console.error('Erro renderRelatorios:',e);}
}


async function carregarNotasFiscaisSupabase(){
  if(!currentOficinaId)return;
  try{
    const resp=await fetch(`${SUPABASE_REST_URL}/notas_fiscais?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
    if(!resp.ok)throw new Error(await resp.text());
    db.notasFiscais=(await resp.json()).map(n=>({
      id:n.id,tipo:n.tipo||'NF',numero:n.numero||n.numero_nf||'',serie:n.serie||'',chave:n.chave_acesso||'',fornecedor:n.fornecedor||'',cnpjFornecedor:n.cnpj_fornecedor||'',dataEmissao:n.data_emissao||String(n.criado_em||'').slice(0,10),produtoId:n.produto_id||'',qtd:Number(n.quantidade||0),valor:Number(n.valor_total||n.valor||0),status:n.status||'Registrada',origem:n.origem||'',origemId:n.origem_id||'',clienteId:n.cliente_id||'',invoiceUrl:n.invoice_url||'',obs:n.observacao||''
    }));
  }catch(e){console.warn('Não carregou notas_fiscais:',e);db.notasFiscais=db.notasFiscais||[];}
}
async function inserirNotaFiscalSupabase(nota){
  if(!currentOficinaId)throw new Error('Oficina não identificada.');
  const payload={
    oficina_id:currentOficinaId,tipo:nota.tipo||'NF',numero:nota.numero||null,serie:nota.serie||null,chave_acesso:nota.chave||null,fornecedor:nota.fornecedor||null,cnpj_fornecedor:nota.cnpjFornecedor||null,data_emissao:nota.dataEmissao||null,produto_id:nota.produtoId?Number(nota.produtoId):null,quantidade:Number(nota.qtd||0),valor_total:Number(nota.valor||0),status:nota.status||'Pendente',origem:nota.origem||null,origem_id:nota.origemId?Number(nota.origemId):null,cliente_id:nota.clienteId?Number(nota.clienteId):null,invoice_url:nota.invoiceUrl||null,observacao:nota.obs||null
  };
  const resp=await fetch(`${SUPABASE_REST_URL}/notas_fiscais`,{method:'POST',headers:supabaseHeaders({'Prefer':'return=representation'}),body:JSON.stringify(payload)});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();return arr[0]||null;
}
async function salvarNFEntrada(){
  const nota={tipo:'NF Entrada',numero:val('nfEntNumero'),serie:val('nfEntSerie'),chave:val('nfEntChave'),fornecedor:val('nfEntFornecedor'),cnpjFornecedor:val('nfEntCnpj'),dataEmissao:val('nfEntData'),produtoId:val('nfEntProduto'),qtd:Number(val('nfEntQtd')||0),valor:Number(val('nfEntValor')||0),status:'Registrada',obs:val('nfEntObs')};
  if(!nota.numero||!nota.fornecedor)return alert('Número da NF e fornecedor são obrigatórios.');
  try{await inserirNotaFiscalSupabase(nota);await carregarNotasFiscaisSupabase();limparNFEntrada();renderAll();alert('NF Entrada salva.');}
  catch(e){console.error(e);db.notasFiscais=db.notasFiscais||[];db.notasFiscais.unshift({...nota,id:Date.now()});save();alert('NF Entrada salva localmente. Para salvar no Supabase, confira as colunas da tabela notas_fiscais.');}
}
function limparNFEntrada(){['nfEntradaEditId','nfEntNumero','nfEntSerie','nfEntChave','nfEntFornecedor','nfEntCnpj','nfEntData','nfEntQtd','nfEntValor','nfEntObs'].forEach(id=>{let e=document.getElementById(id);if(e)e.value='';});}
async function emitirNotaCaixa(tipo){
  const vendaId=val('caixaPagamentoVendaId'), osId=val('caixaPagamentoOsId');
  const origem=vendaId?'Venda':(osId?'OS':'Manual');
  const origemId=vendaId||osId||'';
  let clienteId='',valor=0,descricao='';
  if(origem==='Venda'){let v=db.vendas.find(x=>String(x.id)===String(vendaId)); if(v){clienteId=v.clienteId;valor=v.total;descricao=v.numero+' - '+v.produto;}}
  if(origem==='OS'){let o=db.os.find(x=>String(x.id)===String(osId)); if(o){clienteId=o.clienteId;valor=osTotal(o);descricao=o.numero+' - '+clienteName(o.clienteId);}}
  const nota={tipo,numero:tipo.replace(/\W/g,'')+String(Date.now()).slice(-6),dataEmissao:todayISO(),clienteId,valor,status:'Pendente',origem,origemId,obs:`${tipo} solicitada pelo Caixa. ${descricao}. Integração fiscal real será ativada futuramente.`};
  try{await inserirNotaFiscalSupabase(nota);await carregarNotasFiscaisSupabase();renderAll();alert(`${tipo} registrada como pendente.`);}catch(e){console.error(e);db.notasFiscais=db.notasFiscais||[];db.notasFiscais.unshift({...nota,id:Date.now()});save();alert(`${tipo} registrada localmente como pendente.`);}
}
function abrirHistoricoCliente(id){
  const c=db.clientes.find(x=>String(x.id)===String(id)); if(!c)return alert('Cliente não encontrado.');
  const vendas=db.vendas.filter(v=>String(v.clienteId)===String(id));
  const motos=db.motos.filter(m=>String(m.clienteId)===String(id));
  const ordens=db.os.filter(o=>String(o.clienteId)===String(id));
  const notas=(db.notasFiscais||[]).filter(n=>String(n.clienteId||'')===String(id));
  document.getElementById('clienteHistoricoTitulo').innerText='Histórico de '+c.nome;
  document.getElementById('clienteHistoricoConteudo').innerHTML=`
    <h3>Compras / Vendas</h3>${vendas.length?'<table><tr><th>Data</th><th>Nº</th><th>Produto</th><th>Valor</th></tr>'+vendas.map(v=>`<tr><td>${brDate(v.data)}</td><td>${v.numero}</td><td>${v.produto}</td><td>${money(v.total)}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma venda.</p>'}
    <h3>O.S.</h3>${ordens.length?'<table><tr><th>Data</th><th>Nº</th><th>Moto</th><th>Status</th><th>Valor</th></tr>'+ordens.map(o=>`<tr><td>${brDate(o.data)}</td><td>${o.numero}</td><td>${motoName(o.motoId)}</td><td>${o.status}</td><td>${money(osTotal(o))}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma O.S.</p>'}
    <h3>Motos</h3>${motos.length?'<table><tr><th>Placa</th><th>Marca/Modelo</th><th>Ano</th></tr>'+motos.map(m=>`<tr><td>${m.placa}</td><td>${m.marca} ${m.modelo}</td><td>${m.ano||'-'}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma moto.</p>'}
    <h3>NF / NFC-e / NFS-e</h3>${notas.length?'<table><tr><th>Data</th><th>Tipo</th><th>Nº</th><th>Status</th><th>Valor</th></tr>'+notas.map(n=>`<tr><td>${brDate(n.dataEmissao)}</td><td>${n.tipo}</td><td>${n.numero||'-'}</td><td>${n.status||'-'}</td><td>${money(n.valor||0)}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma nota salva.</p>'}`;
  document.getElementById('clienteHistoricoModal').classList.add('show');
}
function fecharHistoricoCliente(){document.getElementById('clienteHistoricoModal').classList.remove('show');}
function formaNormalizada(forma){let f=String(forma||'').toLowerCase();if(f.includes('dinheiro'))return 'Dinheiro';if(f.includes('pix'))return 'PIX';if(f.includes('débito')||f.includes('debito'))return 'Débito';if(f.includes('crédito')||f.includes('credito'))return 'Crédito';return forma||'-';}
function limparFiltroFechamento(){let a=document.getElementById('fechaInicio'),b=document.getElementById('fechaFim');if(a)a.value='';if(b)b.value='';renderAll();}
function renderFechamentoCaixa(){
  const inicio=val('fechaInicio'),fim=val('fechaFim');
  const movs=(db.financeiroOficina||[]).filter(f=>String(f.tipo||'').toLowerCase().includes('entrada')).filter(f=>{let d=f.data;if(inicio&&d<inicio)return false;if(fim&&d>fim)return false;return true;});
  const grupos={'Dinheiro':0,'PIX':0,'Débito':0,'Crédito':0};
  movs.forEach(f=>{let forma=formaNormalizada(f.formaPagamento); if(grupos[forma]!==undefined)grupos[forma]+=Number(f.valor||0);});
  let box=document.getElementById('fechamentoResumo'); if(box)box.innerHTML=`<div class="caixa-forma-card dinheiro"><h3>Dinheiro</h3><div class="valor">${money(grupos.Dinheiro)}</div></div><div class="caixa-forma-card pix"><h3>PIX</h3><div class="valor">${money(grupos.PIX)}</div></div><div class="caixa-forma-card debito"><h3>Débito</h3><div class="valor">${money(grupos.Débito)}</div></div><div class="caixa-forma-card credito"><h3>Crédito</h3><div class="valor">${money(grupos.Crédito)}</div></div>`;
  table('fechamentoTable',['Data','Forma','Origem','Descrição','Valor'],movs.map(f=>[brDate(f.data),formaNormalizada(f.formaPagamento),f.origem||'-',f.desc||'-',money(f.valor||0)]));
}


// ===== V30 Controle Total =====
function getPermissoesPadrao(perfil){
  const todas=['dashboard','clientes','clientes_criar','clientes_editar','clientes_excluir','motos','motos_criar','motos_editar','os','os_criar','os_editar','orcamentos','vendas','vendas_criar','estoque','estoque_editar','caixa','fechamentoCaixa','financeiro','relatorios','nfEntrada','emitir_nfe','emitir_nfce','emitir_nfse','funcionarios','usuarios','configuracoes','auditoria','contatoPro'];
  const caixa=['caixa','financeiro','relatorios'];
  const atendente=['dashboard','clientes','clientes_criar','clientes_editar','motos','motos_criar','motos_editar','os','os_criar','os_editar','orcamentos','vendas','vendas_criar','estoque'];
  if(perfil==='adm')return todas;
  if(perfil==='caixa')return caixa;
  if(perfil==='atendente')return atendente;
  return [];
}
function renderPermissoesUsuario(){
  const box=document.getElementById('permissoesUsuarioBox');
  if(!box)return;
  const itens=[
    ['Operação',['dashboard','clientes','clientes_criar','clientes_editar','clientes_excluir','motos','motos_criar','motos_editar','os','os_criar','os_editar','orcamentos','vendas','vendas_criar','estoque','estoque_editar']],
    ['Gestão',['caixa','fechamentoCaixa','financeiro','relatorios','nfEntrada']],
    ['Fiscal',['emitir_nfe','emitir_nfce','emitir_nfse']],
    ['Administração',['funcionarios','usuarios','configuracoes','auditoria','contatoPro']]
  ];
  const nomes={dashboard:'Dashboard',clientes:'Clientes',clientes_criar:'Cadastrar clientes',clientes_editar:'Editar clientes',clientes_excluir:'Excluir clientes',motos:'Motos',motos_criar:'Cadastrar motos',motos_editar:'Editar motos',os:'O.S.',os_criar:'Criar O.S.',os_editar:'Editar O.S.',orcamentos:'Orçamentos',vendas:'Vendas',vendas_criar:'Criar vendas',estoque:'Estoque',estoque_editar:'Editar estoque',caixa:'Caixa',fechamentoCaixa:'Fechamento de Caixa',financeiro:'Financeiro',relatorios:'Relatórios',nfEntrada:'NF Entrada',emitir_nfe:'Emitir NF-e',emitir_nfce:'Emitir NFC-e',emitir_nfse:'Emitir NFS-e',funcionarios:'Funcionários',usuarios:'Usuários',configuracoes:'Configurações',auditoria:'Auditoria',contatoPro:'Contato Pro'};
  box.innerHTML='<div class="perm-grid">'+itens.map(grupo=>`<div class="perm-card"><div class="perm-title">${grupo[0]}</div>${grupo[1].map(k=>`<label><input type="checkbox" class="perm-check" value="${k}"> ${nomes[k]||k}</label>`).join('')}</div>`).join('')+'</div>';
  aplicarPermissoesPerfil();
}
function aplicarPermissoesPerfil(){
  const perfil=val('usuarioSistemaPerfil')||val('userPerfil')||'atendente';
  const selecionadas=getPermissoesPadrao(perfil==='oficina_admin'?'adm':perfil);
  document.querySelectorAll('.perm-check').forEach(c=>c.checked=selecionadas.includes(c.value));
}
function permissoesSelecionadas(){
  return Array.from(document.querySelectorAll('.perm-check')).filter(c=>c.checked).map(c=>c.value);
}
function dataMovimento(m){return (m.criado_em||m.criadoEm||m.data||m.data_pagamento||'').slice(0,10);}
function dentroPeriodoData(data,inicio,fim){const d=String(data||'').slice(0,10); if(!d)return true; if(inicio&&d<inicio)return false; if(fim&&d>fim)return false; return true;}
function formaNormalizada(forma){const f=String(forma||'').toLowerCase(); if(f.includes('dinheiro'))return'Dinheiro'; if(f.includes('pix'))return'PIX'; if(f.includes('débito')||f.includes('debito'))return'Débito'; if(f.includes('crédito')||f.includes('credito'))return'Crédito'; return forma||'-';}
function limparFiltroFechamento(){const a=document.getElementById('fechaInicio');const b=document.getElementById('fechaFim'); if(a)a.value=''; if(b)b.value=''; renderAll();}
function renderFechamentoCaixa(){
  const inicio=val('fechaInicio'),fim=val('fechaFim');
  const movimentos=(db.caixa||[]).filter(m=>dentroPeriodoData(dataMovimento(m),inicio,fim));
  const entradas=movimentos.filter(m=>String(m.tipo||'').toLowerCase().includes('entrada')||String(m.tipo||'').toLowerCase().includes('venda'));
  const grupos={'Dinheiro':0,'PIX':0,'Débito':0,'Crédito':0};
  entradas.forEach(m=>{const f=formaNormalizada(m.forma_pagamento||m.forma||m.pagamento); if(grupos[f]!==undefined)grupos[f]+=Number(m.valor||0);});
  const total=Object.values(grupos).reduce((a,b)=>a+b,0);
  const box=document.getElementById('fechamentoResumo');
  if(box)box.innerHTML=`<div class="caixa-forma-card dinheiro"><h3>Dinheiro</h3><div class="valor">${money(grupos.Dinheiro)}</div></div><div class="caixa-forma-card pix"><h3>PIX</h3><div class="valor">${money(grupos.PIX)}</div></div><div class="caixa-forma-card debito"><h3>Débito</h3><div class="valor">${money(grupos.Débito)}</div></div><div class="caixa-forma-card credito"><h3>Crédito</h3><div class="valor">${money(grupos.Crédito)}</div></div><div class="caixa-forma-card total"><h3>Total</h3><div class="valor">${money(total)}</div></div>`;
  table('fechamentoTable',['Data','Forma','Descrição','Valor'],entradas.map(m=>[brDate(dataMovimento(m)),formaNormalizada(m.forma_pagamento||m.forma||m.pagamento),m.descricao||'-',money(m.valor||0)]));
}
async function emitirNotaCaixa(tipo){
  const vendaId=val('caixaPagamentoVendaId'),osId=val('caixaPagamentoOsId');
  const origem=vendaId?'Venda':(osId?'O.S.':'Caixa');
  const origemId=vendaId||osId||'';
  const nota={oficina_id:oficinaIdAtual?oficinaIdAtual():currentOficinaId,tipo,origem,origem_id:origemId,status:'Pendente',forma_pagamento:val('caixaFormaPagamento')||'',criado_em:new Date().toISOString(),observacao:`${tipo} registrada no caixa. Integração fiscal real futura.`};
  try{
    if(typeof supabaseInsert==='function') await supabaseInsert('notas_fiscais',nota);
    else {db.notasFiscais=db.notasFiscais||[];db.notasFiscais.unshift({...nota,id:Date.now()}); if(typeof saveLocal==='function')saveLocal();}
    alert(`${tipo} registrada como Pendente.`);
  }catch(e){console.error(e);alert(`Erro ao registrar ${tipo}.`);}
}
async function salvarNFEntrada(lancarEstoque=false){
  const reg={oficina_id:oficinaIdAtual?oficinaIdAtual():currentOficinaId,tipo:'NF Entrada',numero:val('nfEntNumero'),serie:val('nfEntSerie'),chave_acesso:val('nfEntChave'),fornecedor:val('nfEntFornecedor'),cnpj_fornecedor:val('nfEntCnpj'),data_emissao:val('nfEntData'),produto_id:val('nfEntProduto')||null,quantidade:Number(val('nfEntQtd')||0),valor_unitario:Number(val('nfEntUnitario')||0),valor_total:Number(val('nfEntValor')||0),cfop:val('nfEntCfop'),ncm:val('nfEntNcm'),observacao:val('nfEntObs'),status:'Registrada',criado_em:new Date().toISOString()};
  if(!reg.numero||!reg.fornecedor)return alert('Número da NF e fornecedor são obrigatórios.');
  try{
    if(typeof supabaseInsert==='function') await supabaseInsert('notas_fiscais',reg);
    else {db.notasFiscais=db.notasFiscais||[];db.notasFiscais.unshift({...reg,id:Date.now()});}
    alert(lancarEstoque?'NF Entrada salva e pronta para vínculo com estoque.':'NF Entrada salva.');
    limparNFEntrada(); renderAll();
  }catch(e){console.error(e);alert('Erro ao salvar NF Entrada.');}
}
function limparNFEntrada(){['nfEntNumero','nfEntSerie','nfEntChave','nfEntFornecedor','nfEntCnpj','nfEntData','nfEntQtd','nfEntUnitario','nfEntValor','nfEntCfop','nfEntNcm','nfEntObs'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});}
function abrirHistoricoCliente(id){
  const c=(db.clientes||[]).find(x=>String(x.id)===String(id));
  if(!c)return alert('Cliente não encontrado.');
  const vendas=(db.vendas||[]).filter(v=>String(v.cliente_id||v.clienteId||v.cliente)===String(id));
  const motos=(db.motos||[]).filter(m=>String(m.cliente_id||m.clienteId||m.cliente)===String(id));
  const os=(db.ordens_servico||db.ordens||db.os||[]).filter(o=>String(o.cliente_id||o.clienteId||o.cliente)===String(id));
  const notas=(db.notasFiscais||[]).filter(n=>String(n.cliente_id||n.clienteId||'')===String(id));
  document.getElementById('clienteHistoricoTitulo').innerText='Histórico de '+(c.nome||c.nome_razao_social||'Cliente');
  document.getElementById('clienteHistoricoConteudo').innerHTML=`<h3>Compras</h3>${vendas.length?'<table><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr>'+vendas.map(v=>`<tr><td>${brDate((v.criado_em||v.data||'').slice(0,10))}</td><td>${v.descricao||v.numero||'Venda'}</td><td>${money(v.valor_total||v.valor||0)}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma venda.</p>'}<h3>O.S.</h3>${os.length?'<table><tr><th>Data</th><th>Número</th><th>Status</th><th>Valor</th></tr>'+os.map(o=>`<tr><td>${brDate((o.criado_em||o.data||'').slice(0,10))}</td><td>${o.numero||o.codigo||o.id}</td><td>${o.status||'-'}</td><td>${money(o.valor_total||o.total||0)}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma O.S.</p>'}<h3>Motos</h3>${motos.length?'<table><tr><th>Placa</th><th>Modelo</th><th>Ano</th></tr>'+motos.map(m=>`<tr><td>${m.placa||'-'}</td><td>${m.marca||''} ${m.modelo||''}</td><td>${m.ano||'-'}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma moto.</p>'}<h3>NF-e / NFC-e / NFS-e</h3>${notas.length?'<table><tr><th>Data</th><th>Tipo</th><th>Status</th></tr>'+notas.map(n=>`<tr><td>${brDate((n.criado_em||'').slice(0,10))}</td><td>${n.tipo||'-'}</td><td>${n.status||'-'}</td></tr>`).join('')+'</table>':'<p class="muted">Nenhuma nota salva.</p>'}`;
  document.getElementById('clienteHistoricoModal').classList.add('show');
}
function fecharHistoricoCliente(){document.getElementById('clienteHistoricoModal').classList.remove('show');}
function salvarConfigFiscal(){alert('Configuração fiscal salva no app. Integração com banco pode ser ativada na próxima etapa.');}


// ===== V31 Operação Completa =====
let fiscalFiltroAtual='Todos';
function v31InitArrays(){db.compras=db.compras||[];db.notasFiscais=db.notasFiscais||db.notas_fiscais||[];db.garantias=db.garantias||[];}
function v31Audit(acao,detalhe){db.audit=db.audit||[];db.audit.unshift({data:new Date().toLocaleString('pt-BR'),usuario:currentUser||'sistema',acao,detalhe});}
function calcularTotalCompra(){const q=Number(val('compraQtd')||0),u=Number(val('compraValorUnit')||0);const e=document.getElementById('compraValorTotal');if(e)e.value=(q*u).toFixed(2);}
function limparCompra(){['compraEditId','compraFornecedor','compraQtd','compraValorUnit','compraValorTotal','compraData','compraObs'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});}
function produtoNomeV31(id){const p=(db.estoque||[]).find(x=>String(x.id)===String(id));return p?.produto||p?.nome||p?.descricao||'-';}
function nomeClienteV31(id){const c=(db.clientes||[]).find(x=>String(x.id)===String(id));return c?.nome||c?.nome_razao_social||'-';}
function compraPayload(status='Pedido'){return{id:val('compraEditId')||Date.now(),oficina_id:typeof oficinaIdAtual==='function'?oficinaIdAtual():currentOficinaId,fornecedor:val('compraFornecedor'),produto_id:val('compraProduto'),data:val('compraData')||todayISO(),quantidade:Number(val('compraQtd')||0),valor_unitario:Number(val('compraValorUnit')||0),valor_total:Number(val('compraValorTotal')||0),observacao:val('compraObs'),status,criado_em:new Date().toISOString()};}
function salvarCompra(){v31InitArrays();const c=compraPayload('Pedido');if(!c.fornecedor||!c.produto_id||c.quantidade<=0)return alert('Fornecedor, produto e quantidade são obrigatórios.');db.compras.unshift(c);v31Audit('Compra','Criou pedido de compra');limparCompra();renderAll();}
function receberCompra(){v31InitArrays();const c=compraPayload('Recebida');if(!c.fornecedor||!c.produto_id||c.quantidade<=0)return alert('Fornecedor, produto e quantidade são obrigatórios.');const p=(db.estoque||[]).find(x=>String(x.id)===String(c.produto_id));if(p){p.qtd=Number(p.qtd||p.quantidade||0)+c.quantidade;p.quantidade=p.qtd;p.ultima_compra=c.data;p.ultimo_fornecedor=c.fornecedor;}db.compras.unshift(c);v31Audit('Estoque','Recebeu compra e lançou estoque');limparCompra();renderAll();alert('Compra recebida e estoque atualizado.');}
function gerarNFEntradaDaCompra(){v31InitArrays();const c=compraPayload('NF Entrada gerada');db.notasFiscais.unshift({id:Date.now(),oficina_id:c.oficina_id,tipo:'NF Entrada',numero:'',fornecedor:c.fornecedor,produto_id:c.produto_id,valor:c.valor_total,status:'Pendente',data_emissao:c.data,criado_em:new Date().toISOString(),observacao:'NF Entrada gerada a partir de compra.'});db.compras.unshift(c);v31Audit('NF Entrada','Gerou NF Entrada a partir de compra');limparCompra();renderAll();}
function setFiscalFiltro(tipo){fiscalFiltroAtual=tipo;['Todos','NFe','NFCe','NFSe'].forEach(k=>{const e=document.getElementById('tabFiscal'+k);if(e)e.classList.remove('active')});const id='tabFiscal'+(tipo==='NF-e'?'NFe':tipo==='NFC-e'?'NFCe':tipo==='NFS-e'?'NFSe':'Todos');const b=document.getElementById(id);if(b)b.classList.add('active');renderFiscalV31();}
function statusFiscalBadge(s){const st=String(s||'Pendente');if(st==='Emitida')return'<span class="nf-status emitida">Emitida</span>';if(st==='Cancelada')return'<span class="nf-status cancelada">Cancelada</span>';if(st==='Erro')return'<span class="nf-status erro">Erro</span>';return'<span class="nf-status pendente">Pendente</span>';}
function renderFiscalV31(){v31InitArrays();let notas=db.notasFiscais||[];if(fiscalFiltroAtual!=='Todos')notas=notas.filter(n=>String(n.tipo)===fiscalFiltroAtual);table('fiscalTable',['Data','Tipo','Número','Cliente/Fornecedor','Valor','Status','Ações'],notas.map(n=>[brDate((n.data_emissao||n.criado_em||'').slice(0,10)),n.tipo||'-',n.numero||n.serie||'-',n.cliente_nome||n.fornecedor||'-',money(n.valor||n.valor_total||0),statusFiscalBadge(n.status),`<button class="small blue" onclick="marcarNotaEmitida(${n.id})">Marcar emitida</button> <button class="small secondary" onclick="marcarNotaCancelada(${n.id})">Cancelar</button>`]));}
function marcarNotaEmitida(id){v31InitArrays();const n=db.notasFiscais.find(x=>String(x.id)===String(id));if(n){n.status='Emitida';v31Audit('Fiscal','Marcou nota emitida');renderAll();}}
function marcarNotaCancelada(id){v31InitArrays();const n=db.notasFiscais.find(x=>String(x.id)===String(id));if(n){n.status='Cancelada';v31Audit('Fiscal','Cancelou nota');renderAll();}}
function limparGarantia(){['garantiaEditId','garantiaOrigem','garantiaNome','garantiaPrazo','garantiaDataInicio','garantiaDesc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});}
function salvarGarantia(){v31InitArrays();const g={id:val('garantiaEditId')||Date.now(),oficina_id:typeof oficinaIdAtual==='function'?oficinaIdAtual():currentOficinaId,cliente_id:val('garantiaCliente'),origem:val('garantiaOrigem'),nome:val('garantiaNome'),prazo:Number(val('garantiaPrazo')||0),data_inicio:val('garantiaDataInicio')||todayISO(),status:val('garantiaStatus')||'Ativa',descricao:val('garantiaDesc'),criado_em:new Date().toISOString()};if(!g.cliente_id||!g.nome||g.prazo<=0)return alert('Cliente, nome e prazo são obrigatórios.');db.garantias.unshift(g);v31Audit('Garantia','Criou garantia '+g.nome);limparGarantia();renderAll();}
function garantiaVencimento(g){const d=new Date((g.data_inicio||todayISO())+'T00:00:00');d.setDate(d.getDate()+Number(g.prazo||0));return d.toISOString().slice(0,10);}
function garantiaStatusAtual(g){if(g.status==='Cancelada')return'Cancelada';return todayISO()>garantiaVencimento(g)?'Vencida':'Ativa';}
function renderGarantiasV31(){v31InitArrays();table('garantiasTable',['Cliente','Origem','Garantia','Prazo','Vencimento','Status','Descrição'],(db.garantias||[]).map(g=>[nomeClienteV31(g.cliente_id),g.origem||'-',g.nome||'-',`${g.prazo||0} dias`,brDate(garantiaVencimento(g)),garantiaStatusAtual(g),g.descricao||'-']));}
function renderComprasV31(){v31InitArrays();table('comprasTable',['Data','Fornecedor','Produto','Qtd','Unitário','Total','Status','Obs'],(db.compras||[]).map(c=>[brDate(c.data),c.fornecedor||'-',produtoNomeV31(c.produto_id),c.quantidade||0,money(c.valor_unitario||0),money(c.valor_total||0),c.status||'Pedido',c.observacao||'-']));}
function renderNFEntradaV31(){v31InitArrays();const notas=(db.notasFiscais||[]).filter(n=>String(n.tipo||'')==='NF Entrada');table('nfEntradaTable',['Data','Número','Fornecedor','Valor','Status','Ações'],notas.map(n=>[brDate((n.data_emissao||n.criado_em||'').slice(0,10)),n.numero||'-',n.fornecedor||'-',money(n.valor||n.valor_total||0),statusFiscalBadge(n.status),`<button class="small blue" onclick="marcarNotaEmitida(${n.id})">Visualizar/Emitida</button> <button class="small secondary" onclick="marcarNotaCancelada(${n.id})">Cancelar</button>`]));}
function renderDashboardExecutivoV31(){const hoje=todayISO(),mes=hoje.slice(0,7),vendas=db.vendas||[],os=db.os||db.ordens||db.ordens_servico||[];const vm=vendas.filter(v=>String(v.data||v.criado_em||'').slice(0,7)===mes);const fatHoje=vendas.filter(v=>String(v.data||v.criado_em||'').slice(0,10)===hoje).reduce((s,v)=>s+Number(v.total||v.valor_total||v.valor||0),0);const fatMes=vm.reduce((s,v)=>s+Number(v.total||v.valor_total||v.valor||0),0);const set=(id,val)=>{const e=document.getElementById(id);if(e)e.innerText=val};set('dashFatHoje',money(fatHoje));set('dashFatMes',money(fatMes));set('dashTicketMedio',money(vm.length?fatMes/vm.length:0));set('dashClientesAtivos',(db.clientes||[]).length);set('dashProdutosVendidos',vendas.reduce((s,v)=>s+Number(v.qtd||v.quantidade||1),0));set('dashOsAbertas',os.filter(o=>!['Entregue','Finalizada'].includes(o.status)).length);set('dashOsConcluidas',os.filter(o=>['Entregue','Finalizada'].includes(o.status)).length);set('dashProdutosEstoque',(db.estoque||[]).length);}
function preencherSelectsV31(){const prod=(db.estoque||[]).map(p=>[p.id,p.produto||p.nome||p.descricao||'-']);const cli=(db.clientes||[]).map(c=>[c.id,c.nome||c.nome_razao_social||'-']);if(typeof fillSelect==='function'){fillSelect('compraProduto',prod);fillSelect('nfEntProduto',prod);fillSelect('garantiaCliente',cli);}}
function garantirMenuV31(){const nav=document.getElementById('nav');if(!nav||document.getElementById('nav-compras'))return;[['compras','📦 Compras'],['nfEntrada','📥 NF Entrada'],['fiscal','📄 Fiscal'],['garantias','🛡 Garantias']].forEach(([id,label])=>{if(document.getElementById('nav-'+id))return;const b=document.createElement('button');b.id='nav-'+id;b.innerHTML=label;b.onclick=()=>showSection(id);nav.appendChild(b);});}
function renderV31(){v31InitArrays();garantirMenuV31();preencherSelectsV31();renderComprasV31();renderNFEntradaV31();renderFiscalV31();renderGarantiasV31();renderDashboardExecutivoV31();}

function renderAll(){
  try{renderV31();}catch(e){console.warn('V31 render:',e);}
 try{
 updatePlanUI();
 setTextSafe('currentPlan', db.plan); // elemento pode não existir no novo layout
 setTextSafe('mClientes', db.clientes.length);setTextSafe('mMotos', db.motos.length);setTextSafe('mOs', db.os.filter(o=>o.status!=='Entregue').length);setTextSafe('mVendas', db.vendas.length);
 fillSelect('motoCliente',db.clientes.map(c=>[c.id,c.nome]));
 fillSelect('nfEntProduto',(db.estoque||[]).map(p=>[p.id,`${p.codigo} - ${p.produto}`]));
 fillSelect('vendaCliente',db.clientes.map(c=>[c.id,c.nome]));
 fillSelect('vendaVendedor',db.funcionarios.filter(f=>String(f.status||'Ativo')==='Ativo').map(f=>[f.id,`${f.nome} - ${f.cargo||''}`]));
 fillSelect('osVendedor',db.funcionarios.filter(f=>String(f.status||'Ativo')==='Ativo').map(f=>[f.id,`${f.nome} - ${f.cargo||''}`]));
 let estoqueDisponivel=db.estoque.filter(p=>Number(p.qtd)>0).map(p=>[p.id,`${p.codigo} - ${p.produto} | ${money(p.venda)} | Est: ${p.qtd}`]);fillSelect('vendaProduto',estoqueDisponivel);fillSelect('osPecaSelect',estoqueDisponivel);fillSelect('osMecanico',db.funcionarios.filter(f=>String(f.status||'Ativo')==='Ativo' && String(f.cargo||'').toLowerCase().includes('mecânico')).map(f=>[f.id,`${f.nome} (${f.comissao}% comissão)`]));
 table('clientesTable',['Nome','Telefone','CPF/CNPJ','Cidade','Ações'],db.clientes.map(c=>[c.nome,c.telefone,c.doc||'-',c.cidade||'-',`<button class="small blue" onclick="editCliente(${c.id})">Editar</button> <button class=\"small secondary\" onclick=\"abrirHistoricoCliente(${c.id})\">Histórico</button> <button class="small secondary" onclick="abrirHistoricoCliente(${c.id})">Histórico</button> <button class="small secondary" onclick="deleteCliente(${c.id})">Excluir</button>`]));
 table('motosTable',['Placa','Marca','Modelo','Cor','Ano','Cliente','Ações'],db.motos.map(m=>[m.placa,m.marca,m.modelo,m.cor,m.ano,clienteName(m.clienteId),`<button class="small secondary" onclick="deleteMoto(${m.id})">Excluir</button>`]));
 table('osTable',['Nº','Data','Cliente','Moto','Vendedor','Total','Status','Ações'],db.os.map(o=>[o.numero,brDate(o.data),clienteName(o.clienteId),motoName(o.motoId),func(o.vendedorId).nome||'-',money(osTotal(o)),`<span class="badge yellow">${o.status}</span>`,`<button class="small blue" onclick="startEditOS(${o.id})">Editar</button> <button class="small" onclick="openPrintOS(${o.id})">Imprimir</button> <button class="small secondary" onclick="deleteOS(${o.id})">Excluir</button>`]));
 let aguardando=db.os.filter(o=>o.status==='Aguardando aprovação');
 table('orcamentosTable',['O.S.','Cliente','Moto','Vendedor','Peças','Mão de obra','Total','Ações'],aguardando.map(o=>[o.numero,clienteName(o.clienteId),motoName(o.motoId),func(o.vendedorId).nome||'-',money((o.pecas||[]).reduce((s,p)=>s+p.total,0)),money((o.mao||[]).reduce((s,m)=>s+m.valor,0)),money(osTotal(o)),`<button class="small blue" onclick="startEditOS(${o.id});showSection('os')">Editar O.S.</button>`]));
 table('vendasTable',['Nº','Data','Cliente','Vendedor','Produto','Qtd','Total','Pagamento','Status','Caixa/NF'],db.vendas.map(v=>[
   v.numero,
   brDate(v.data),
   clienteName(v.clienteId),
   v.vendedorNome||func(v.vendedorId).nome||'-',
   `${v.codigo? v.codigo+' - ' : ''}${v.produto}`,
   v.qtd,
   money(v.total),
   v.formaPagamento||'-',
   v.status==='Finalizada'?'<span class="badge green">Pago</span>':'<span class="badge yellow">Aguardando caixa</span>',
   v.status==='Finalizada'?'<span class="badge green">NF emitida</span>':`<button class="small green" onclick="iniciarPagamentoCaixa(${v.id});showSection('caixa')">Receber no caixa</button>`
 ]));
 table('estoqueTable',['Código','Produto','Qtd','Custo','Venda','Lucro','NCM','CFOP','Unid.','Fornecedor','Ações'],db.estoque.map(p=>{
   let margem=(Number(p.custo)>0 && Number(p.venda)>0)?(((Number(p.venda)-Number(p.custo))/Number(p.custo))*100).toFixed(2).replace('.',',')+'%':'-';
   return [p.codigo,p.produto,p.qtd,money(p.custo),money(p.venda),margem,p.ncm||'-',p.cfop||'-',p.unidade_comercial||'UN',p.fornecedor||'-',`<button class="small blue" onclick="editEstoque(${p.id})">Editar</button> <button class="small secondary" onclick="deleteEstoque(${p.id})">Excluir</button>`]
 }));
 let codEl=document.getElementById('estoqueCodigo');
 if(codEl && !codEl.value) codEl.value=proximoCodigoProduto();
 let movs=[];
 let online=(db.financeiroOficina||[]).filter(f=>dentroPeriodo(f.data));
 online.forEach(f=>movs.push([
   brDate(f.data),
   `${f.tipo||'-'}${f.origem? ' / '+f.origem : ''}`,
   `${f.desc||'-'}${f.formaPagamento? ' | '+f.formaPagamento : ''}`,
   money((f.tipo==='Saída'||f.tipo==='Saida')?-f.valor:f.valor)
 ]));
 let manuais=(db.financeiro||[]).filter(f=>dentroPeriodo(f.data));
 manuais.forEach(f=>movs.push([brDate(f.data),f.tipo,f.desc,money(f.tipo==='Saída'?-f.valor:f.valor)]));
 table('financeiroTable',['Data','Tipo','Descrição','Valor'],movs);
 let funcRows=db.funcionarios.map(f=>{let mao=db.os.flatMap(o=>o.mao||[]).filter(m=>String(m.funcId)===String(f.id));let total=mao.reduce((s,m)=>s+m.valor,0);let com=mao.reduce((s,m)=>s+m.comissaoValor,0);return[f.nome,f.cpf||'-',f.telefone||'-',f.cargo||'-',money(f.salario||0),(f.comissao||0)+'%',f.dataAdmissao?brDate(f.dataAdmissao):'-',f.status||'Ativo',money(total),money(com),`<button class="small blue" onclick="editFunc(${f.id})">Editar</button> <button class="small secondary" onclick="deleteFunc(${f.id})">Excluir</button>`]});table('funcTable',['Nome','CPF','Telefone','Cargo','Salário','Comissão','Admissão','Status','M.O. feita','Comissão a pagar','Ações'],funcRows);
 let usuariosSistema=(db.usuariosSistema||[]);
 table('usersTable',['ID','Nome','Login','Perfil','Status','Primeiro acesso','Ações'],usuariosSistema.map(u=>[
   u.id,
   u.nome||'-',
   u.email||'-',
   mapPerfilToRole(u.perfil),
   u.ativo?'<span class="badge green">Ativo</span>':'<span class="badge red">Inativo</span>',
   u.primeiro_acesso?'<span class="badge yellow">Sim</span>':'Não',
   `<div class="user-actions"><button class="small blue" onclick="editarUsuarioSistema(${u.id})">Editar</button><button class="small secondary" onclick="redefinirSenhaUsuarioSistema(${u.id})">Redefinir senha</button><button class="small ${u.ativo?'secondary':'green'}" onclick="alternarUsuarioSistema(${u.id},${!u.ativo})">${u.ativo?'Desativar':'Ativar'}</button></div>`
 ]));
 table('auditTable',['Data','Usuário','Ação'],db.audit.map(a=>[a.data,a.user,a.msg]));
 document.getElementById('empNome').value=db.empresa.nome||'';document.getElementById('empDoc').value=db.empresa.doc||'';document.getElementById('empTel').value=db.empresa.tel||'';document.getElementById('empEnd').value=db.empresa.end||'';
 let logoPrev=document.getElementById('empLogoPreview');
 if(logoPrev){
   logoPrev.innerHTML=db.empresa.logo?`<div class="muted">Logo atual:</div><img src="${db.empresa.logo}" style="max-width:120px;max-height:80px;background:white;border-radius:8px;padding:6px;margin-top:6px">`:'Nenhuma logo cadastrada.';
 }
 let ps=document.getElementById('planSelect'); if(ps)ps.value=db.plan;
 let pr=document.getElementById('planoResumo'); if(pr)pr.innerHTML=`<b>Plano atual:</b> ${db.plan||'Start'}<br><b>Oficina:</b> ${db.empresa.nome||'MotoSOS Gestão'}<br><b>Regra:</b> ${planKey()==='pro'?'Acesso total':'Somente categoria Operação + Plano'}`;
 renderPlanoComercial();
 let cm=document.getElementById('cargoMecanicoNome'); if(cm) cm.value=cargoNome('mecanico');
 let cv=document.getElementById('cargoVendedorNome'); if(cv) cv.value=cargoNome('vendedor');
 let vendaTotal=db.vendas.reduce((s,v)=>s+v.total,0);let maoTotal=db.os.flatMap(o=>o.mao||[]).reduce((s,m)=>s+m.valor,0);let comTotal=db.os.flatMap(o=>o.mao||[]).reduce((s,m)=>s+m.comissaoValor,0);let ent=db.financeiro.filter(f=>f.tipo==='Entrada').reduce((s,f)=>s+f.valor,0);let sai=db.financeiro.filter(f=>f.tipo==='Saída').reduce((s,f)=>s+f.valor,0);
 setTextSafe('rVendas', money(vendaTotal));setTextSafe('rMao', money(maoTotal));setTextSafe('rComissao', money(comTotal));setTextSafe('rSaldo', money(ent-sai));
 let vendasPeriodo=(db.vendas||[]).filter(v=>dentroPeriodo(v.data));
 let finVendasTotal=vendasPeriodo.reduce((s,v)=>s+Number(v.total||0),0);
 let finOsTotalGeral=db.os.filter(o=>o.entregaData && dentroPeriodo(o.entregaData)).reduce((s,o)=>s+osTotal(o),0);
 let finOsAbertas=db.os.filter(o=>o.status!=='Entregue' && dentroPeriodo(o.data)).reduce((s,o)=>s+osTotal(o),0);
 let finEnt=manuais.filter(f=>f.tipo==='Entrada').reduce((s,f)=>s+Number(f.valor||0),0);
 let finSai=manuais.filter(f=>f.tipo==='Saída').reduce((s,f)=>s+Number(f.valor||0),0);
 let onlineEntradas=online.filter(f=>String(f.tipo||'').toLowerCase().includes('entrada')).reduce((s,f)=>s+Number(f.valor||0),0);
 let onlineSaidas=online.filter(f=>String(f.tipo||'').toLowerCase().includes('saída')||String(f.tipo||'').toLowerCase().includes('saida')).reduce((s,f)=>s+Number(f.valor||0),0);
 let caixaPeriodo=(db.caixa||[]).filter(c=>dentroPeriodo(c.data));
 let caixaSaidas=caixaPeriodo.filter(c=>sinalCaixa(c.tipo)<0).reduce((s,c)=>s+Number(c.valor||0),0);
 let caixaEntradas=caixaPeriodo.filter(c=>sinalCaixa(c.tipo)>0).reduce((s,c)=>s+Number(c.valor||0),0);
 let elFinGeral=document.getElementById('finGeralTotal'); if(elFinGeral)elFinGeral.innerText=money(finVendasTotal+finOsTotalGeral);
 let foa=document.getElementById('finOsAbertasTotal'); if(foa)foa.innerText=money(finOsAbertas);
 let fe=document.getElementById('finEntradasTotal'); if(fe)fe.innerText=money(onlineEntradas+finEnt+caixaEntradas);
 let fsa=document.getElementById('finSaidasTotal'); if(fsa)fsa.innerText=money(finSai+caixaSaidas);
 let limits=planLimits();
 let qtdAdm=db.users.filter(u=>u.role==='ADM').length, qtdAt=db.users.filter(u=>u.role==='Atendimento').length;
 let pui=document.getElementById('planUserInfo'); if(pui)pui.innerHTML=`Plano <b>${limits.nome}</b>: permite <b>${limits.adm} instalação(ões) ADM</b> em PC ou celular e <b>${limits.atendimento} instalação(ões) de vendedor/atendimento</b> em aparelhos separados. Usuários cadastrados agora: <b>${qtdAdm} ADM</b> e <b>${qtdAt} Atendimento</b>.`; let ds=document.getElementById('deviceSummary'); if(ds)ds.innerHTML=`<div class="card"><div class="muted">Instalações ADM usadas</div><div class="metric">${qtdAdm}/${limits.adm}</div></div><div class="card"><div class="muted">Instalações vendedor/atendimento usadas</div><div class="metric">${qtdAt}/${limits.atendimento}</div></div>`;
 table('chamadosTable',['Data','Assunto','Prioridade','Status'],(db.chamados||[]).map(c=>[c.data,c.assunto,c.prioridade,c.status]));
 const vendasPendentes=(db.vendas||[]).filter(v=>v.status!=='Finalizada');
 table('caixaPendentesTable',['Nº','Data','Cliente','Produto','Qtd','Total','Status','Ação'],vendasPendentes.map(v=>[
   v.numero,brDate(v.data),clienteName(v.clienteId),v.produto,v.qtd,money(v.total),'<span class="badge yellow">Aguardando pagamento</span>',`<button class="small green" onclick="iniciarPagamentoCaixa(${v.id})">Receber / NF</button>`
 ]));
 renderRelatorios();
 renderCaixa();
 renderFechamentoCaixa();
  renderPermissoesUsuario();
 table('nfEntradaTable',['Data','Fornecedor','Número','Série','Produto','Qtd','Valor','Status'],(db.notasFiscais||[]).filter(n=>n.tipo==='NF Entrada').map(n=>[brDate(n.dataEmissao),n.fornecedor||'-',n.numero||'-',n.serie||'-',(db.estoque.find(p=>String(p.id)===String(n.produtoId))||{}).produto||'-',n.qtd||'-',money(n.valor||0),`<span class="nf-status emitida">${n.status||'Registrada'}</span>`]));
 atualizarCardsFinanceiroECaixa();
 }catch(e){console.error('Erro renderAll:',e);}
}


function iniciarPagamentoCaixa(id){
  const v=db.vendas.find(x=>String(x.id)===String(id));
  if(!v)return alert('Venda não encontrada.');
  if(v.status==='Finalizada')return alert('Venda já está paga.');
  document.getElementById('caixaPagamentoTipo').value='Venda';
  document.getElementById('caixaPagamentoVendaId').value=v.id;
  document.getElementById('caixaPagamentoOsId').value='';
  document.getElementById('caixaPagamentoInfo').innerHTML=`<b>${v.numero}</b><br>Tipo: Venda<br>Cliente: ${clienteName(v.clienteId)}<br>Produto: ${v.produto}<br>Qtd: ${v.qtd}<br><div class="caixa-total">${money(v.total)}</div><div class="row"><button class="secondary small" onclick="alert('Prévia da NF da venda ${v.numero}')">NF</button></div>`;
  document.getElementById('caixaPagamentoBox').style.display='block';
}
function iniciarPagamentoOS(id){
  const o=db.os.find(x=>String(x.id)===String(id));
  if(!o)return alert('O.S. não encontrada.');
  const total=osTotal(o);
  if(total<=0)return alert('Esta O.S. não possui valor de peças ou mão de obra. Edite a O.S. e lance os itens antes de receber.');
  document.getElementById('caixaPagamentoTipo').value='OS';
  document.getElementById('caixaPagamentoVendaId').value='';
  document.getElementById('caixaPagamentoOsId').value=o.id;
  document.getElementById('caixaPagamentoInfo').innerHTML=`<b>${o.numero}</b><br>Tipo: Ordem de Serviço<br>Cliente: ${clienteName(o.clienteId)}<br>Moto: ${motoName(o.motoId)}<br>Status: ${o.status}<br><div class="caixa-total">${money(total)}</div><div class="row"><button class="secondary small" onclick="openPrintOS(${o.id})">Imprimir O.S.</button><button class="secondary small" onclick="alert('Prévia da NF da O.S. ${o.numero}')">NF</button></div>`;
  document.getElementById('caixaPagamentoBox').style.display='block';
}
function cancelarPagamentoCaixa(){
  document.getElementById('caixaPagamentoTipo').value='';
  document.getElementById('caixaPagamentoVendaId').value='';
  document.getElementById('caixaPagamentoOsId').value='';
  document.getElementById('caixaPagamentoBox').style.display='none';
  document.getElementById('caixaPagamentoInfo').innerHTML='Selecione uma venda ou O.S. pendente.';
}
async function finalizarVendaNoCaixa(){
  const tipo=val('caixaPagamentoTipo');
  const forma=val('caixaFormaPagamento')||'PIX';
  if(tipo==='Venda'){
    const id=val('caixaPagamentoVendaId');
    if(!id)return alert('Selecione uma venda pendente.');
    const v=db.vendas.find(x=>String(x.id)===String(id));
    if(!v)return alert('Venda não encontrada.');
    try{
      await atualizarVendaSupabase(id,{status:'Finalizada',forma_pagamento:forma});
      await carregarVendasSupabase();
      await carregarFinanceiroOficinaSupabase();
      await carregarCaixaSupabase();
      cancelarPagamentoCaixa();
      renderAll();
      alert('Pagamento da venda confirmado no caixa. Use os botões NF-e, NFC-e ou NFS-e para registrar a nota.');
    }catch(e){console.error(e);alert('Erro ao finalizar pagamento da venda. Confira Console/Network.');}
    return;
  }
  if(tipo==='OS'){
    const id=val('caixaPagamentoOsId');
    const o=db.os.find(x=>String(x.id)===String(id));
    if(!o)return alert('O.S. não encontrada.');
    const total=osTotal(o);
    try{
      await atualizarOSSupabase({...o,status:'Entregue'});
      await criarFinanceiroOficinaSupabase({origem:'OS',origemId:o.id,tipo:'Entrada',descricao:`O.S. ${o.numero} - ${clienteName(o.clienteId)}`,valor:total,formaPagamento:forma,status:'Recebido'});
      await criarCaixaSupabase({tipo:'Entrada',descricao:`O.S. ${o.numero} - ${clienteName(o.clienteId)}`,valor:total,origem:'OS',origemId:o.id});
      await carregarOSSupabase();
      await carregarFinanceiroOficinaSupabase();
      await carregarCaixaSupabase();
      cancelarPagamentoCaixa();
      renderAll();
      alert('Pagamento da O.S. confirmado no caixa. Use os botões NF-e, NFC-e ou NFS-e para registrar a nota.');
    }catch(e){console.error(e);alert('Erro ao finalizar pagamento da O.S. Verifique se ela já não foi recebida.');}
    return;
  }
  alert('Busque uma venda ou O.S. para receber.');
}
function normalizarNumeroCaixa(n){return String(n||'').toUpperCase().replace(/\s|-/g,'')}
function buscarCobrancaCaixa(){
  const numero=normalizarNumeroCaixa(val('caixaBuscaNumero'));
  if(!numero)return alert('Digite o número da venda ou da O.S.');
  if(numero.startsWith('VEND')){
    const v=db.vendas.find(x=>normalizarNumeroCaixa(x.numero)===numero);
    if(!v)return alert('Venda não encontrada.');
    return iniciarPagamentoCaixa(v.id);
  }
  if(numero.startsWith('OS')){
    const o=db.os.find(x=>normalizarNumeroCaixa(x.numero)===numero);
    if(!o)return alert('O.S. não encontrada.');
    return iniciarPagamentoOS(o.id);
  }
  alert('Número inválido. Use VEND0001 ou OS0001.');
}
function finalizarCobrancaCaixa(){finalizarVendaNoCaixa();}

function globalSearch(){let q=val('globalSearch').toLowerCase(),r=[];if(!q){document.getElementById('searchResults').innerHTML='Digite na barra superior para pesquisar.';return}db.clientes.forEach(c=>{if((c.nome+c.telefone+c.doc).toLowerCase().includes(q))r.push('Cliente: '+c.nome+' - '+c.telefone)});db.motos.forEach(m=>{if((m.placa+m.modelo+m.marca).toLowerCase().includes(q))r.push('Moto: '+m.modelo+' - '+m.placa)});db.os.forEach(o=>{if((o.numero+o.problema).toLowerCase().includes(q))r.push('O.S.: '+o.numero+' - '+clienteName(o.clienteId))});document.getElementById('searchResults').innerHTML=r.length?r.map(x=>'<div>'+x+'</div>').join(''):'Nada encontrado.'}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function osPublicUrl(o){
  const base=location.origin+location.pathname;
  return `${base}?os=${encodeURIComponent(o.numero||o.numero_os||o.id)}`;
}
function qrUrl(data,size=120){
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}
function fakeBarcode(text){
  return String(text||'OS').replace(/./g,(ch,i)=> i%3===0?'█':(i%3===1?'▌':'▐')).repeat(3).slice(0,34);
}
function openPrintOS(id){
  let o=db.os.find(x=>String(x.id)===String(id));
  if(!o)return alert('O.S. não encontrada.');
  let c=cliente(o.clienteId),m=moto(o.motoId),e=db.empresa||{};
  let tp=(o.pecas||[]).reduce((s,p)=>s+Number(p.total||0),0);
  let tm=(o.mao||[]).reduce((s,x)=>s+Number(x.valor||0),0);
  let total=tp+tm;
  const numero=escapeHtml(o.numero||o.numero_os||('OS'+String(o.id).padStart(4,'0')));
  const link=osPublicUrl(o);
  const qr=qrUrl(link,92);
  const logo=e.logo?`<img src="${escapeHtml(e.logo)}" alt="Logo da oficina">`:`<div class="os-print-logo-fallback">Moto<span>SOS</span></div>`;
  const mecanico=func(o.mecanicoId).nome || (o.mao||[])[0]?.mecanico || '-';
  const pecas=(o.pecas||[]).slice(0,7).map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.nome||p.descricao||'Peça')}</td><td>${Number(p.qtd||p.quantidade||0)}</td><td>${money(p.total||0)}</td></tr>`).join('') || '<tr><td>-</td><td>Sem peças lançadas</td><td>-</td><td>R$ 0,00</td></tr>';
  const mao=(o.mao||[]).slice(0,5).map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x.desc||x.descricao||'Mão de obra')}</td><td>${escapeHtml(x.mecanico||func(x.funcId).nome||mecanico||'-')}</td><td>${money(x.valor||0)}</td></tr>`).join('') || '<tr><td>-</td><td>Sem mão de obra lançada</td><td>-</td><td>R$ 0,00</td></tr>';
  document.getElementById('printOS').innerHTML=`
  <div class="os-print-page os-print-page-compact">
    <div class="os-print-header compact-head">
      <div class="os-print-logo compact-logo">${logo}</div>
      <div class="os-print-company compact-company">
        <h1>${escapeHtml(e.nome||'Nome da oficina')}</h1>
        <p><b>CNPJ/CPF:</b> ${escapeHtml(e.doc||'Não informado')}</p>
        <p><b>Endereço:</b> ${escapeHtml(e.end||'Endereço não informado')}</p>
        <p><b>Telefone:</b> ${escapeHtml(e.tel||'Não informado')}</p>
      </div>
      <div class="compact-os-box">
        <div class="compact-os-title">ORDEM DE SERVIÇO</div>
        <b>${numero}</b>
        <small>ID ${escapeHtml(String(o.id||'').padStart(6,'0'))}</small>
      </div>
    </div>

    <div class="compact-row compact-dates">
      <div><b>Entrada:</b> ${brDate(o.dataEntrada||o.data)||'__/__/____'}</div>
      <div><b>Prevista:</b> ${brDate(o.dataPrevista)||'__/__/____'}</div>
      <div><b>Entrega:</b> ${brDate(o.dataEntrega||o.entregaData)||'__/__/____'}</div>
      <div><b>Status:</b> ${escapeHtml(o.status||'-')}</div>
    </div>

    <div class="compact-two">
      <div class="compact-box"><h2>CLIENTE</h2><p><b>Nome:</b> ${escapeHtml(c.nome||'')}</p><p><b>Telefone:</b> ${escapeHtml(c.telefone||'')}</p></div>
      <div class="compact-box"><h2>MOTO</h2><p><b>Placa:</b> ${escapeHtml(m.placa||'')} &nbsp; <b>Cor:</b> ${escapeHtml(m.cor||'')}</p><p><b>Marca/Modelo:</b> ${escapeHtml([m.marca,m.modelo].filter(Boolean).join(' - '))} &nbsp; <b>Ano:</b> ${escapeHtml(m.ano||'')}</p></div>
    </div>

    <div class="compact-box full"><h2>MECÂNICO RESPONSÁVEL</h2><p>${escapeHtml(mecanico)}</p></div>
    <div class="compact-box full"><h2>PROBLEMA RELATADO</h2><p>${escapeHtml(o.problema||o.problema_relatado||'')}</p></div>

    <div class="compact-box full"><h2>PEÇAS</h2><table class="compact-table"><tr><th>#</th><th>Descrição</th><th>Qtd</th><th>Total</th></tr>${pecas}<tr><td colspan="3"><b>Total peças</b></td><td><b>${money(tp)}</b></td></tr></table></div>
    <div class="compact-box full"><h2>MÃO DE OBRA</h2><table class="compact-table"><tr><th>#</th><th>Serviço</th><th>Mecânico</th><th>Valor</th></tr>${mao}<tr><td colspan="3"><b>Total mão de obra</b></td><td><b>${money(tm)}</b></td></tr></table></div>

    <div class="compact-total"><span>VALOR TOTAL</span><strong>${money(total)}</strong></div>

    <div class="compact-footer">
      <div class="compact-sign"><b>ASSINATURA DO CLIENTE</b><span></span></div>
      <div class="compact-sign"><b>ASSINATURA DA OFICINA</b><span></span></div>
      <div class="compact-qr"><b>CONSULTE A O.S.</b><img src="${qr}" alt="QR Code"><small>Escaneie para acompanhar o status</small></div>
    </div>
    <div class="compact-brand">Moto<span>SOS</span> Gestão para Oficinas</div>
  </div>`;
  showSection('impressao')
}


/* ===== V1.1 - Auditoria + Mecânico responsável + Comissão automática ===== */
function safeSetValue(id,value){const e=document.getElementById(id); if(e)e.value=value??'';}
function safeText(id,value){const e=document.getElementById(id); if(e)e.innerText=value??'';}
function normalizarStatusOS(){
  const opts=['Aguardando aprovação','Aprovada','Em execução','Pronta para retirada','Entregue'];
  ['osStatus','editOSStatus'].forEach(id=>{
    const el=document.getElementById(id); if(!el)return;
    const atual=el.value;
    el.innerHTML=opts.map(o=>`<option>${o}</option>`).join('');
    if(opts.includes(atual))el.value=atual;
  });
}
function inserirCamposOSV11(){
  normalizarStatusOS();
  const formCard=document.querySelector('#os .form-card');
  if(formCard && !document.getElementById('osMecanicoResponsavel')){
    const ref=document.getElementById('osVendedor');
    const bloco=document.createElement('div');
    bloco.innerHTML=`
      <label>Mecânico responsável</label><select id="osMecanicoResponsavel"></select>
      <div class="three">
        <div><label>Data entrada</label><input id="osDataEntrada" type="date"></div>
        <div><label>Data prevista entrega</label><input id="osDataPrevista" type="date"></div>
        <div><label>Data entrega</label><input id="osDataEntrega" type="date"></div>
      </div>`;
    ref?.parentNode?.insertBefore(bloco, ref.nextSibling);
  }
  const editBox=document.getElementById('editOSBox');
  if(editBox && !document.getElementById('editOSMecanicoResponsavel')){
    const ref=document.getElementById('editOSStatus');
    const bloco=document.createElement('div');
    bloco.innerHTML=`
      <label>Mecânico responsável</label><select id="editOSMecanicoResponsavel"></select>
      <div class="three">
        <div><label>Data entrada</label><input id="editOSDataEntrada" type="date"></div>
        <div><label>Data prevista entrega</label><input id="editOSDataPrevista" type="date"></div>
        <div><label>Data entrega</label><input id="editOSDataEntrega" type="date"></div>
      </div>`;
    ref?.parentNode?.insertBefore(bloco, ref.nextSibling);
  }
}
function funcionariosMecanicosAtivos(){
  return (db.funcionarios||[]).filter(f=>String(f.status||'Ativo')==='Ativo' && String(f.cargo||'').toLowerCase().includes('mecânico'));
}
function preencherSelectMecanicosV11(){
  const opts=funcionariosMecanicosAtivos().map(f=>[f.id,`${f.nome} - ${f.cargo||''} (${Number(f.comissao||0)}%)`]);
  fillSelect('osMecanicoResponsavel',opts);
  fillSelect('editOSMecanicoResponsavel',opts);
  fillSelect('osMecanico',opts);
}
async function registrarAuditoria(acao, modulo='Sistema', referenciaId=null, detalhes=''){
  const item={
    data:new Date().toLocaleString('pt-BR'),
    user:current?.nome||currentSupabaseUser?.nome||current?.user||'sistema',
    msg:`${modulo}: ${acao}${detalhes? ' - '+detalhes:''}`
  };
  if(!db.audit)db.audit=[];
  db.audit.unshift(item);
  try{
    if(currentOficinaId){
      await fetch(`${SUPABASE_REST_URL}/auditoria`,{
        method:'POST',
        headers:supabaseHeaders({'Prefer':'return=minimal'}),
        body:JSON.stringify({
          oficina_id:currentOficinaId,
          usuario_id:currentSupabaseUser?.id||null,
          usuario_nome:item.user,
          acao,
          modulo,
          referencia_id:referenciaId,
          detalhes
        })
      });
    }
  }catch(e){console.warn('Auditoria não enviada:',e);}
}
audit=function(msg){registrarAuditoria(msg,'Sistema',null,'');};
async function carregarAuditoriaSupabase(){
  if(!currentOficinaId)return;
  try{
    const resp=await fetch(`${SUPABASE_REST_URL}/auditoria?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc&limit=80`,{headers:supabaseHeaders()});
    if(!resp.ok)throw new Error(await resp.text());
    const arr=await resp.json();
    db.audit=(arr||[]).map(a=>({
      data:a.criado_em?new Date(a.criado_em).toLocaleString('pt-BR'):'-',
      user:a.usuario_nome||'-',
      msg:`${a.modulo||'Sistema'}: ${a.acao||''}${a.detalhes?' - '+a.detalhes:''}`
    }));
  }catch(e){console.warn('Erro ao carregar auditoria:',e);}
}
const _carregarFuncionariosSupabaseV11=carregarFuncionariosSupabase;
carregarFuncionariosSupabase=async function(){
  await _carregarFuncionariosSupabaseV11();
  try{
    const resp=await fetch(`${SUPABASE_REST_URL}/funcionarios?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
    if(resp.ok){
      const arr=await resp.json();
      db.funcionarios=(arr||[]).map(f=>({
        id:f.id,nome:f.nome||'',cpf:f.cpf||'',telefone:f.telefone||'',cargo:f.cargo||'Mecânico I',
        salario:Number(f.salario||0),comissao:Number(f.comissao_percentual||0),dataAdmissao:f.data_admissao||'',status:f.status||'Ativo',
        totalProduzido:Number(f.total_produzido||0),totalComissao:Number(f.total_comissao||0),totalOs:Number(f.total_os||0)
      }));
    }
  }catch(e){console.warn(e);}
};
carregarOSSupabase=async function(){
  if(!currentOficinaId)return;
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?oficina_id=eq.${currentOficinaId}&select=*&order=id.desc`,{headers:supabaseHeaders()});
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  db.os=(arr||[]).map(o=>({
    id:o.id,
    numero:o.numero_os || ('OS'+String(o.id).padStart(4,'0')),
    clienteId:o.cliente_id,
    motoId:o.moto_id,
    problema:o.problema_relatado||'',
    status:o.status||'Aguardando aprovação',
    vendedorId:o.vendedor_id||'',
    mecanicoId:o.mecanico_id||'',
    data:o.data_entrada || (o.criado_em||'').slice(0,10)||todayISO(),
    dataEntrada:o.data_entrada || (o.criado_em||'').slice(0,10)||todayISO(),
    dataPrevista:o.data_prevista||'',
    entregaData:o.data_entrega||null,
    dataEntrega:o.data_entrega||'',
    pagamentoData:null,
    pecas:Array.isArray(o.itens_pecas)?o.itens_pecas:[],
    mao:Array.isArray(o.itens_mao_obra)?o.itens_mao_obra:[],
    valorTotal:Number(o.valor_total||0)
  }));
};
criarOSSupabase=async function(o){
  if(!currentOficinaId)throw new Error('Oficina não identificada. Faça login novamente.');
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico`,{
    method:'POST',
    headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      oficina_id:currentOficinaId,
      cliente_id:o.clienteId,
      moto_id:o.motoId,
      numero_os:o.numero,
      status:o.status||'Aguardando aprovação',
      problema_relatado:o.problema||null,
      observacoes:o.observacoes||null,
      mecanico_id:o.mecanicoId||null,
      data_entrada:o.dataEntrada||todayISO(),
      data_prevista:o.dataPrevista||null,
      data_entrega:o.dataEntrega||null,
      mao_obra:0,valor_pecas:0,valor_total:0,
      itens_pecas:o.pecas||[],itens_mao_obra:o.mao||[]
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  const arr=await resp.json();
  await registrarAuditoria(`Criou O.S. ${o.numero}`,'O.S.',arr[0]?.id||null,clienteName(o.clienteId));
  return arr[0]||null;
};
atualizarOSSupabase=async function(o){
  const valorMao=(o.mao||[]).reduce((s,m)=>s+Number(m.valor||0),0);
  const valorPecas=(o.pecas||[]).reduce((s,p)=>s+Number(p.total||0),0);
  const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?id=eq.${o.id}&oficina_id=eq.${currentOficinaId}`,{
    method:'PATCH',headers:supabaseHeaders({'Prefer':'return=representation'}),
    body:JSON.stringify({
      status:o.status,
      problema_relatado:o.problema||null,
      mecanico_id:o.mecanicoId||null,
      data_entrada:o.dataEntrada||o.data||todayISO(),
      data_prevista:o.dataPrevista||null,
      data_entrega:o.status==='Entregue'?(o.dataEntrega||todayISO()):(o.dataEntrega||null),
      mao_obra:valorMao,valor_pecas:valorPecas,valor_total:valorMao+valorPecas,
      itens_pecas:o.pecas||[],itens_mao_obra:o.mao||[]
    })
  });
  if(!resp.ok)throw new Error(await resp.text());
  await registrarAuditoria(`Editou O.S. ${o.numero}`,'O.S.',o.id,`Status: ${o.status}`);
  return await resp.json();
};
async function aplicarComissaoOS(o){
  if(!o || String(o.status)!=='Entregue')return;
  const porFunc={};
  (o.mao||[]).forEach(m=>{
    const fid=m.funcId||o.mecanicoId;
    if(!fid)return;
    if(!porFunc[fid])porFunc[fid]={valor:0,comissao:0};
    porFunc[fid].valor+=Number(m.valor||0);
    porFunc[fid].comissao+=Number(m.comissaoValor||0);
  });
  for(const [fid,valores] of Object.entries(porFunc)){
    const f=(db.funcionarios||[]).find(x=>String(x.id)===String(fid));
    const novoProd=Number(f?.totalProduzido||0)+valores.valor;
    const novaCom=Number(f?.totalComissao||0)+valores.comissao;
    const novoOs=Number(f?.totalOs||0)+1;
    try{
      await fetch(`${SUPABASE_REST_URL}/funcionarios?id=eq.${fid}&oficina_id=eq.${currentOficinaId}`,{
        method:'PATCH',headers:supabaseHeaders({'Prefer':'return=minimal'}),
        body:JSON.stringify({total_produzido:novoProd,total_comissao:novaCom,total_os:novoOs})
      });
      await registrarAuditoria(`Calculou comissão de ${f?.nome||fid}`,'Comissão',Number(fid),`${o.numero}: ${money(valores.comissao)}`);
    }catch(e){console.warn('Erro comissão:',e);}
  }
  await carregarFuncionariosSupabase();
}
const _addOSV11=addOS;
addOS=async function(){
  let o={
    numero:proximaOS(),clienteId:val('osCliente'),motoId:val('osMoto'),problema:val('osProblema'),
    status:val('osStatus')||'Aguardando aprovação',vendedorId:val('osVendedor'),mecanicoId:val('osMecanicoResponsavel'),
    dataEntrada:val('osDataEntrada')||todayISO(),dataPrevista:val('osDataPrevista')||'',dataEntrega:val('osDataEntrega')||'',
    data:val('osDataEntrada')||todayISO(),entregaData:null,pagamentoData:null,pecas:[],mao:[]
  };
  if(!o.clienteId||!o.motoId)return alert('Digite uma placa cadastrada para puxar cliente e moto.');
  if(!o.mecanicoId)return alert('Selecione o mecânico responsável.');
  try{
    await criarOSSupabase(o);await carregarOSSupabase();
    clear(['osProblema','osBuscaPlaca','osDataPrevista','osDataEntrega']);safeSetValue('osDataEntrada',todayISO());
    document.getElementById('osDadosEncontrados').innerHTML='Digite uma placa já cadastrada para puxar cliente e moto automaticamente.';
    alert('O.S. salva no Supabase com sucesso.');renderAll();
  }catch(e){console.error(e);alert('Erro ao salvar O.S. no Supabase.');}
};
startEditOS=function(id){
  let o=db.os.find(x=>String(x.id)===String(id));if(!o)return;
  tempEdit=JSON.parse(JSON.stringify(o));
  document.getElementById('editOSBox').style.display='block';
  document.getElementById('editOSId').value=id;
  document.getElementById('editOSTitle').innerText='Editar '+o.numero;
  document.getElementById('editOSStatus').value=o.status;
  safeSetValue('editOSMecanicoResponsavel',o.mecanicoId||'');
  safeSetValue('editOSDataEntrada',o.dataEntrada||o.data||todayISO());
  safeSetValue('editOSDataPrevista',o.dataPrevista||'');
  safeSetValue('editOSDataEntrega',o.dataEntrega||o.entregaData||'');
  renderOSItens();
};
saveOSEdit=async function(){
  let id=Number(val('editOSId'));let idx=db.os.findIndex(o=>String(o.id)===String(id));if(idx<0)return;
  let oldStatus=db.os[idx].status;
  tempEdit.status=val('editOSStatus');
  tempEdit.mecanicoId=val('editOSMecanicoResponsavel');
  tempEdit.dataEntrada=val('editOSDataEntrada')||todayISO();
  tempEdit.dataPrevista=val('editOSDataPrevista')||'';
  tempEdit.dataEntrega=val('editOSDataEntrega')||'';
  if(tempEdit.status==='Entregue' && !tempEdit.dataEntrega)tempEdit.dataEntrega=todayISO();
  try{
    await atualizarOSSupabase(tempEdit);
    if(tempEdit.status==='Entregue' && oldStatus!=='Entregue')await aplicarComissaoOS(tempEdit);
    await carregarOSSupabase();
    tempEdit=null;document.getElementById('editOSBox').style.display='none';renderAll();
    alert('O.S. atualizada.');
  }catch(e){console.error(e);alert('Erro ao atualizar O.S.');}
};
const _loginV11=login;
login=async function(){
  await _loginV11();
  if(currentOficinaId){await carregarAuditoriaSupabase(); renderAll();}
};
const _renderAllV11=renderAll;
renderAll=function(){
  inserirCamposOSV11();
  preencherSelectMecanicosV11();
  _renderAllV11();
  inserirCamposOSV11();normalizarStatusOS();preencherSelectMecanicosV11();
  table('osTable',['Nº','Entrada','Prevista','Cliente','Moto','Mecânico','Total','Status','Ações'],(db.os||[]).map(o=>[
    o.numero,brDate(o.dataEntrada||o.data),brDate(o.dataPrevista),clienteName(o.clienteId),motoName(o.motoId),func(o.mecanicoId).nome||'-',money(osTotal(o)),`<span class="badge yellow">${o.status}</span>`,`<button class="small blue" onclick="startEditOS(${o.id})">Editar</button> <button class="small" onclick="openPrintOS(${o.id})">Imprimir</button> <button class="small secondary" onclick="deleteOS(${o.id})">Excluir</button>`
  ]));
  table('funcTable',['Nome','CPF','Telefone','Cargo','Salário','Comissão %','Admissão','Status','O.S.','Produção','Comissão acum.','Ações'],(db.funcionarios||[]).map(f=>[
    f.nome,f.cpf||'-',f.telefone||'-',f.cargo||'-',money(f.salario||0),(f.comissao||0)+'%',f.dataAdmissao?brDate(f.dataAdmissao):'-',f.status||'Ativo',f.totalOs||0,money(f.totalProduzido||0),money(f.totalComissao||0),`<button class="small blue" onclick="editFunc(${f.id})">Editar</button> <button class="small secondary" onclick="deleteFunc(${f.id})">Excluir</button>`
  ]));
  table('auditTable',['Data','Usuário','Ação'],(db.audit||[]).map(a=>[a.data,a.user,a.msg]));
};


async function abrirConsultaPublicaOS(){
  const params=new URLSearchParams(location.search);
  const numero=params.get('os');
  if(!numero)return false;
  const publicEl=document.getElementById('publicOS');
  if(!publicEl)return false;
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='none';
  publicEl.style.display='block';
  publicEl.innerHTML='<div class="public-os-card"><h1>MotoSOS</h1><p>Carregando O.S...</p></div>';
  try{
    const resp=await fetch(`${SUPABASE_REST_URL}/ordens_servico?numero_os=eq.${encodeURIComponent(numero)}&select=*&limit=1`,{headers:supabaseHeaders()});
    if(!resp.ok)throw new Error(await resp.text());
    const arr=await resp.json();
    const os=arr[0];
    if(!os){publicEl.innerHTML='<div class="public-os-card"><h1>O.S. não encontrada</h1><p>Confira o número da ordem de serviço com a oficina.</p></div>';return true;}
    publicEl.innerHTML=`<div class="public-os-card">
      <h1>Consulta de O.S.</h1>
      <p><b>Número:</b> ${escapeHtml(os.numero_os||numero)}</p>
      <div class="public-status">${escapeHtml(os.status||'Em andamento')}</div>
      <p><b>Problema relatado:</b><br>${escapeHtml(os.problema_relatado||'-')}</p>
      <p><b>Data entrada:</b> ${brDate(String(os.data_entrada||os.criado_em||'').slice(0,10))||'-'}</p>
      <p><b>Data prevista:</b> ${brDate(os.data_prevista)||'-'}</p>
      <p><b>Data entrega:</b> ${brDate(os.data_entrega)||'-'}</p>
      <p class="muted">Para mais detalhes, entre em contato com a oficina.</p>
    </div>`;
    return true;
  }catch(e){
    console.error(e);
    publicEl.innerHTML='<div class="public-os-card"><h1>Erro ao consultar O.S.</h1><p>Tente novamente ou fale com a oficina.</p></div>';
    return true;
  }
}

load();
abrirConsultaPublicaOS().then(publicMode=>{ if(publicMode) return;
// Sempre iniciar na tela de login. O acesso só abre depois de validar no Supabase.
document.getElementById('login').style.display='flex';
document.getElementById('app').style.display='none';
});


/* Relatórios limpos - versão corrigida */
function dataRelatorioItem(item){
  return String(item?.criado_em || item?.data || item?.data_entrada || item?.created_at || '').slice(0,10);
}
function totalVendaRel(v){return Number(v?.total || v?.valor_total || 0);}
function totalMaoRel(o){
  if(Array.isArray(o?.mao)) return o.mao.reduce((s,m)=>s+Number(m.valor||0),0);
  if(Array.isArray(o?.itens_mao_obra)) return o.itens_mao_obra.reduce((s,m)=>s+Number(m.valor||m.total||0),0);
  return Number(o?.mao_obra || 0);
}
function renderRelatoriosGraficosLimpo(){
  try{
    renderGraficoBarra('graficoVendasDia',agruparSoma(db.vendas||[],dataRelatorioItem,totalVendaRel,false),{money:true});
    renderGraficoBarra('graficoVendasMes',agruparSoma(db.vendas||[],dataRelatorioItem,totalVendaRel,true),{money:true});
    renderGraficoBarra('graficoOsDia',agruparContagem(db.os||[],dataRelatorioItem,false));
    renderGraficoBarra('graficoOsMes',agruparContagem(db.os||[],dataRelatorioItem,true));
    renderGraficoBarra('graficoMaoObraMes',agruparSoma(db.os||[],dataRelatorioItem,totalMaoRel,true),{money:true});
  }catch(e){console.error('Erro nos gráficos de relatórios:',e);}
}
const _renderAllGraficosCorrigidos = renderAll;
renderAll = function(){
  _renderAllGraficosCorrigidos();
  renderRelatoriosGraficosLimpo();
};



/* Correção Funcionários: produção, O.S. e comissão calculadas a partir das O.S. reais */
function calcularEstatisticaFuncionario(f){
  const fid=String(f.id);
  let osIds=new Set();
  let producao=0;
  let comissao=0;
  (db.os||[]).forEach(o=>{
    let osTemFuncionario=false;
    let maoItens=Array.isArray(o.mao)?o.mao:[];
    if(maoItens.length){
      maoItens.forEach(m=>{
        const itemFunc=String(m.funcId||m.funcionario_id||o.mecanicoId||'');
        if(itemFunc===fid){
          osTemFuncionario=true;
          const valor=Number(m.valor||m.total||0);
          producao+=valor;
          comissao+=Number(m.comissaoValor||m.comissao_valor||0) || (valor*Number(f.comissao||0)/100);
        }
      });
    }else if(String(o.mecanicoId||'')===fid){
      osTemFuncionario=true;
      const valor=Number(o.mao_obra||0) || totalMaoOS(o) || 0;
      producao+=valor;
      comissao+=valor*Number(f.comissao||0)/100;
    }
    if(osTemFuncionario) osIds.add(String(o.id));
  });
  return {
    totalOs: osIds.size || Number(f.totalOs||0),
    totalProduzido: producao || Number(f.totalProduzido||0),
    totalComissao: comissao || Number(f.totalComissao||0)
  };
}

const _carregarFuncionariosCorrigido = carregarFuncionariosSupabase;
carregarFuncionariosSupabase = async function(){
  await _carregarFuncionariosCorrigido();
  db.funcionarios=(db.funcionarios||[]).map(f=>({
    ...f,
    salario:Number(f.salario||0),
    comissao:Number(f.comissao||0),
    totalOs:Number(f.totalOs||0),
    totalProduzido:Number(f.totalProduzido||0),
    totalComissao:Number(f.totalComissao||0)
  }));
};

function renderTabelaFuncionariosCorrigida(){
  const el=document.getElementById('funcTable');
  if(!el)return;
  table('funcTable',['Nome','CPF','Telefone','Cargo','Salário','Comissão %','Admissão','Status','O.S.','Produção','Comissão acum.','Ações'],(db.funcionarios||[]).map(f=>{
    const st=calcularEstatisticaFuncionario(f);
    return [
      f.nome,
      f.cpf||'-',
      f.telefone||'-',
      f.cargo||'-',
      money(f.salario||0),
      (Number(f.comissao||0))+'%',
      f.dataAdmissao?brDate(f.dataAdmissao):'-',
      f.status||'Ativo',
      st.totalOs||0,
      money(st.totalProduzido||0),
      money(st.totalComissao||0),
      `<button class="small blue" onclick="editFunc(${f.id})">Editar</button> <button class="small secondary" onclick="deleteFunc(${f.id})">Excluir</button>`
    ];
  }));
}

const _renderAllFuncionariosCorrigido = renderAll;
renderAll = function(){
  _renderAllFuncionariosCorrigido();
  renderTabelaFuncionariosCorrigida();
};
